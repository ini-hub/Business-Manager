import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  Users,
  Building,
  CreditCard,
  AlertOctagon,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  TrendingDown,
  Loader2,
  AlertCircle,
  HelpCircle,
  FileCheck,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/admin/dashboard/metrics"],
    refetchInterval: 15000, // Poll every 15 seconds for real-time live events feed
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400 mx-auto" />
          <p className="text-slate-400 text-sm font-medium">Aggregating platform operational telemetry...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 bg-rose-500/10 border border-rose-500/20 rounded-3xl flex items-center gap-4 text-rose-300 max-w-xl mx-auto">
        <AlertCircle className="h-8 w-8 shrink-0" />
        <div>
          <h3 className="font-bold text-white">Metrics Stream Offline</h3>
          <p className="text-sm mt-1">Failed to fetch the super admin analytics telemetry. Please verify connectivity or server logs.</p>
        </div>
      </div>
    );
  }

  const { summaryCards, charts, liveActivity, alerts } = data as any;

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      maximumFractionDigits: 0,
    }).format(val);
  };

  const getDeltaBadge = (delta: number | undefined) => {
    if (delta === undefined) return null;
    const isPositive = delta >= 0;
    return (
      <Badge
        variant="outline"
        className={`flex items-center gap-0.5 px-2 py-0.5 border-none font-semibold ${
          isPositive ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
        }`}
      >
        {isPositive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
        {Math.abs(delta)}%
      </Badge>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 font-sans">
      {/* Top Welcome Title Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight font-outfit">Platform Overview</h1>
          <p className="text-slate-400 text-sm mt-1">Real-time enterprise metrics and business operations monitoring.</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 self-start md:self-auto shadow-inner">
          <Activity className="h-4 w-4 text-emerald-400 animate-pulse" />
          Live Telemetry Active
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="bg-slate-900/40 backdrop-blur border-slate-800/80 rounded-2xl overflow-hidden hover:border-slate-700/80 transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Registered</CardTitle>
            <Building className="h-5 w-5 text-indigo-400" />
          </CardHeader>
          <CardContent className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-black text-white font-mono">{summaryCards.totalBusinesses.count}</span>
              {getDeltaBadge(summaryCards.totalBusinesses.deltaPercent)}
            </div>
            <p className="text-xs text-slate-500">Registered business accounts</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/40 backdrop-blur border-slate-800/80 rounded-2xl overflow-hidden hover:border-slate-700/80 transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400">Active Today</CardTitle>
            <Activity className="h-5 w-5 text-emerald-400" />
          </CardHeader>
          <CardContent className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-black text-white font-mono">{summaryCards.activeToday.count}</span>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-none font-semibold">
                {summaryCards.activeToday.percent}%
              </Badge>
            </div>
            <p className="text-xs text-slate-500">Businesses with checkouts today</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/40 backdrop-blur border-slate-800/80 rounded-2xl overflow-hidden hover:border-slate-700/80 transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400">Monthly GMV</CardTitle>
            <CreditCard className="h-5 w-5 text-emerald-400" />
          </CardHeader>
          <CardContent className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-2xl font-black text-white font-mono truncate">
                {formatCurrency(summaryCards.gmvMonth.count)}
              </span>
              {getDeltaBadge(summaryCards.gmvMonth.deltaPercent)}
            </div>
            <p className="text-xs text-slate-500">Gross sales volume (last 30d)</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/40 backdrop-blur border-slate-800/80 rounded-2xl overflow-hidden hover:border-slate-700/80 transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Users</CardTitle>
            <Users className="h-5 w-5 text-purple-400" />
          </CardHeader>
          <CardContent className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-black text-white font-mono">{summaryCards.totalUsers.count}</span>
            </div>
            <p className="text-xs text-slate-500">Staff, managers and platform owners</p>
          </CardContent>
        </Card>
      </div>

      {/* Warning/Alerts Section (Requires Attention) */}
      {alerts && alerts.length > 0 && (
        <div className="bg-slate-900/30 border border-slate-800 rounded-3xl p-6">
          <h3 className="text-sm font-extrabold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
            <AlertOctagon className="h-5 w-5 text-amber-500" />
            Operational Alerts (Requires Attention)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {alerts.map((alert: any, idx: number) => {
              const isDanger = alert.severity === "danger";
              return (
                <div
                  key={idx}
                  className={`flex items-start gap-3 p-4 border rounded-2xl transition-all duration-300 hover:scale-[1.01] ${
                    isDanger
                      ? "bg-rose-500/10 border-rose-500/25 text-rose-300"
                      : "bg-amber-500/10 border-amber-500/25 text-amber-300"
                  }`}
                >
                  <AlertCircle className={`h-5 w-5 shrink-0 ${isDanger ? "text-rose-400" : "text-amber-400"}`} />
                  <span className="text-xs font-medium leading-relaxed">{alert.message}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Business Growth Chart */}
        <Card className="bg-slate-900/40 backdrop-blur border-slate-800/80 rounded-3xl lg:col-span-2 overflow-hidden">
          <CardHeader className="border-b border-slate-800/80 bg-slate-950/20 px-6 py-5">
            <CardTitle className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              Business Registration Trend (Last 30 Days)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={charts.growthTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorBiz" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#1e293b",
                      borderRadius: "12px",
                      color: "#f8fafc",
                      fontSize: "12px",
                    }}
                  />
                  <Area type="monotone" dataKey="businesses" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorBiz)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Daily Checkout Activity */}
        <Card className="bg-slate-900/40 backdrop-blur border-slate-800/80 rounded-3xl overflow-hidden">
          <CardHeader className="border-b border-slate-800/80 bg-slate-950/20 px-6 py-5">
            <CardTitle className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-indigo-400" />
              Sales Volume & GMV (Weekly)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.transactionTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="day" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    formatter={(value: any, name: string) => [
                      name === "gmv" ? formatCurrency(Number(value)) : value,
                      name === "gmv" ? "GMV" : "Sales Count",
                    ]}
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#1e293b",
                      borderRadius: "12px",
                      color: "#f8fafc",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live Operations Feed & Latency Block */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Operations Feed */}
        <Card className="bg-slate-900/40 backdrop-blur border-slate-800/80 rounded-3xl lg:col-span-2 overflow-hidden">
          <CardHeader className="border-b border-slate-800/80 bg-slate-950/20 px-6 py-5">
            <CardTitle className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-400" />
              Live Operations Feed
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-800/80 max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
              {liveActivity.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-sm">No transaction activity logged in the last 24 hours.</div>
              ) : (
                liveActivity.map((activity: any, idx: number) => {
                  let badgeColor = "bg-indigo-500/10 text-indigo-400";
                  if (activity.type === "business_suspended") {
                    badgeColor = "bg-rose-500/10 text-rose-400";
                  } else if (activity.type === "transaction_completed") {
                    badgeColor = "bg-emerald-500/10 text-emerald-400";
                  }

                  return (
                    <div
                      key={idx}
                      className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-slate-900/30 transition-colors"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <Badge variant="outline" className={`border-none shrink-0 text-[10px] font-bold ${badgeColor}`}>
                          {activity.type.replace("_", " ")}
                        </Badge>
                        <span className="text-xs font-semibold text-slate-300 truncate">{activity.message}</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 shrink-0">{activity.time}</span>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Dashboard Side Info Panel */}
        <Card className="bg-slate-900/40 backdrop-blur border-slate-800/80 rounded-3xl overflow-hidden flex flex-col justify-between">
          <div>
            <CardHeader className="border-b border-slate-800/80 bg-slate-950/20 px-6 py-5">
              <CardTitle className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                <FileCheck className="h-4 w-4 text-emerald-400" />
                Operational Telemetry
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="flex justify-between items-center py-2 border-b border-slate-800/40">
                <span className="text-xs text-slate-400 font-medium">Daily Checkout Count</span>
                <span className="text-sm font-mono font-bold text-white">{summaryCards.transactionsToday.count}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-800/40">
                <span className="text-xs text-slate-400 font-medium">Monthly Checkout Count</span>
                <span className="text-sm font-mono font-bold text-white">{summaryCards.transactionsMonth.count}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-800/40">
                <span className="text-xs text-slate-400 font-medium">Avg Rev. per Active Store</span>
                <span className="text-sm font-mono font-bold text-emerald-400">
                  {formatCurrency(summaryCards.avgRevenuePerBusiness.count)}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-xs text-slate-400 font-medium font-semibold flex items-center gap-1">
                  Active Feature Flags
                  <span title="Platform modules dynamically controlled"><HelpCircle className="h-3 w-3 text-slate-500 cursor-help" /></span>
                </span>
                <span className="text-sm font-mono font-bold text-white">Dynamic Routing Enforced</span>
              </div>
            </CardContent>
          </div>
          <div className="p-6 border-t border-slate-800/40 bg-slate-950/20 text-center">
            <span className="text-[10px] font-bold text-slate-500 tracking-widest uppercase">
              Operations Center v1.0
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}
