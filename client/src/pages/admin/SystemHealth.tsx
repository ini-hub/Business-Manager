import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Server,
  Database,
  AlertTriangle,
  Users,
  Mail,
  MessageSquare,
  Clock,
  RefreshCw,
  TrendingUp,
  Rocket,
} from "lucide-react";
import { useLocation } from "wouter";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const RANGE_OPTIONS = [
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
] as const;
type Range = (typeof RANGE_OPTIONS)[number]["value"];

export default function SystemHealth() {
  const [, navigate] = useLocation();
  const [range, setRange] = useState<Range>("24h");
  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === range)!.label.toLowerCase();
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["/api/admin/system/health", range],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/system/health?range=${range}`);
      return res.json();
    },
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <Activity className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground text-sm font-medium">Querying infrastructure telemetry nodes...</p>
        </div>
      </div>
    );
  }

  if (error || !data?.health) {
    return (
      <div className="p-8 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-2xl flex items-center gap-4 text-rose-700 dark:text-rose-300 max-w-xl mx-auto font-sans">
        <AlertTriangle className="h-8 w-8 shrink-0 animate-bounce" />
        <div>
          <h3 className="font-bold text-foreground">System Diagnostics Offline</h3>
          <p className="text-sm mt-1">Failed to aggregate operational metrics from telemetry providers.</p>
        </div>
      </div>
    );
  }

  const { health, recentErrors, latencyTimeline } = data;
  const featureReview: { pending: number; features: { key: string; name: string }[] } = data.featureReview ?? { pending: 0, features: [] };
  const na = (v: string | number | null | undefined) => (v === null || v === undefined ? "—" : v);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 font-sans">
      {/* Title block */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold text-foreground tracking-tight">Platform Diagnostics & Health</h1>
          <p className="text-muted-foreground text-sm mt-1">Live latency, error and delivery measurements for the selected period. Latency percentiles are approximate (bucketed).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
        <div className="flex rounded-xl border border-border bg-card/60 p-1" role="group" aria-label="Time period">
          {RANGE_OPTIONS.map((o) => (
            <Button
              key={o.value}
              size="sm"
              variant={range === o.value ? "default" : "ghost"}
              className="rounded-lg font-bold"
              aria-pressed={range === o.value}
              onClick={() => setRange(o.value)}
            >
              {o.label}
            </Button>
          ))}
        </div>
        <Button
          variant="outline"
          className="border-border bg-card/60 hover:bg-muted text-muted-foreground rounded-xl font-bold"
          onClick={() => refetch()}
          disabled={isRefetching}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        </div>
      </div>

      {featureReview.pending > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40 px-5 py-4" data-testid="health-feature-review">
          <Rocket className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {featureReview.pending} new feature{featureReview.pending === 1 ? "" : "s"} awaiting review
            </p>
            <p className="text-xs text-amber-800/80 dark:text-amber-300/80 truncate">
              {featureReview.features.slice(0, 4).map((f) => f.name).join(", ")}{featureReview.pending > 4 ? ` and ${featureReview.pending - 4} more` : ""}. Hidden from businesses until priced and published.
            </p>
          </div>
          <Button size="sm" variant="outline" className="rounded-xl" onClick={() => navigate("/super-admin/feature-catalog?active=pending")}>Review</Button>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Metric 1: API Core Latency */}
        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-2xl overflow-hidden hover:border-border/80 transition-all duration-300 shadow-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">API Latency (p50)</CardTitle>
            <Server className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold text-foreground font-mono">{na(health.apiResponseTime)}</span>
              <Badge variant="outline" className="bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 border-none font-bold text-[11px] uppercase">
                {health.apiStatus}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-semibold">{`Median request time (last ${rangeLabel})`}</p>
          </CardContent>
        </Card>

        {/* Metric 2: DB Latency */}
        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-2xl overflow-hidden hover:border-border/80 transition-all duration-300 shadow-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Database Query Time</CardTitle>
            <Database className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold text-foreground font-mono">{na(health.databaseQueryTime)}</span>
              <Badge variant="outline" className="bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 border-none font-bold text-[11px] uppercase">
                {health.databaseStatus}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-semibold">Live SELECT 1 round-trip</p>
          </CardContent>
        </Card>

        {/* Metric 3: Active Operations */}
        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-2xl overflow-hidden hover:border-border/80 transition-all duration-300 shadow-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Active WS Clients</CardTitle>
            <Users className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold text-foreground font-mono">{health.activeSessions}</span>
              <Badge variant="outline" className="bg-violet-100 dark:bg-violet-950/40 text-violet-800 dark:text-violet-400 border-none font-bold text-[11px] uppercase">
                Live Channels
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-semibold">Connected notification sockets</p>
          </CardContent>
        </Card>

        {/* Metric 4: Platform Error Index */}
        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-2xl overflow-hidden hover:border-border/80 transition-all duration-300 shadow-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">HTTP Error Rate</CardTitle>
            <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold text-foreground font-mono">{na(health.errorRate)}</span>
              <Badge variant="outline" className="bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400 border-none font-bold text-[11px] uppercase">
                {health.errorRateStatus}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-semibold">{`Share of requests answered with 5xx (last ${rangeLabel})`}</p>
          </CardContent>
        </Card>
      </div>

      {/* Latency telemetry trend chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-2xl lg:col-span-2 overflow-hidden shadow-2xl">
          <CardHeader className="border-b border-border/80 bg-background/20 px-6 py-5">
            <CardTitle className="text-sm font-bold text-foreground tracking-wide flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              API Percentile Latency Timeline (p50, p95, p99)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={latencyTimeline} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorP50" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#818cf8" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorP95" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
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
                  <Area type="monotone" dataKey="p50" stroke="#818cf8" strokeWidth={2} fillOpacity={1} fill="url(#colorP50)" name="p50 (Median)" />
                  <Area type="monotone" dataKey="p95" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#colorP95)" name="p95" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Dispatch Utilities */}
        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-2xl overflow-hidden flex flex-col justify-between shadow-2xl">
          <div>
            <CardHeader className="border-b border-border/80 bg-background/20 px-6 py-5">
              <CardTitle className="text-sm font-bold text-foreground tracking-wide">Infrastructure Subsystems</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between p-4 bg-background/50 border border-border rounded-2xl">
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-primary" />
                  <div>
                    <span className="block text-xs font-bold text-foreground">Email Server Pool</span>
                    <span className="text-[11px] text-muted-foreground font-semibold">{`Sent vs failed (last ${rangeLabel})`}</span>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">{na(health.emailDeliveryRate)}</span>
              </div>

              <div className="flex items-center justify-between p-4 bg-background/50 border border-border rounded-2xl">
                <div className="flex items-center gap-3">
                  <MessageSquare className="h-5 w-5 text-primary" />
                  <div>
                    <span className="block text-xs font-bold text-foreground">SMS Gateway</span>
                    <span className="text-[11px] text-muted-foreground font-semibold">Not integrated</span>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">{na(health.smsDeliveryRate)}</span>
              </div>
            </CardContent>
          </div>
          <div className="p-5 border-t border-border/40 bg-background/20 text-center">
            <span className="text-[11px] font-bold text-muted-foreground tracking-wider uppercase">Auto-refreshes every 30s</span>
          </div>
        </Card>
      </div>

      {/* Recent Failing Requests / Errors */}
      <Card className="bg-card/40 backdrop-blur border border-border/80 rounded-2xl overflow-hidden shadow-2xl animate-in fade-in duration-300">
        <CardHeader className="bg-background/20 p-6 border-b border-border/40 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold text-foreground">Server Error Log</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              5xx responses across all organisations. The list is held in memory, so it only covers errors since the server last restarted.
            </CardDescription>
          </div>
          <Badge variant="outline" className="bg-rose-100 dark:bg-rose-500/10 border-none text-rose-700 dark:text-rose-600 dark:text-rose-400 text-[11px] font-bold uppercase px-2 py-0.5">
            {recentErrors.length} Server Errors
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-semibold">
              <thead className="bg-background/40 text-muted-foreground uppercase text-[11px] tracking-wider border-b border-border">
                <tr>
                  <th className="px-6 py-4">Timestamp</th>
                  <th className="px-6 py-4">Affected Endpoint</th>
                  <th className="px-6 py-4">Response Status</th>
                  <th className="px-6 py-4">Origin Organisation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentErrors.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">No server errors recorded in this window.</td>
                  </tr>
                )}
                {recentErrors.map((err: any) => (
                  <tr key={err.id} className="hover:bg-card/30 transition-colors">
                    <td className="px-6 py-4 text-muted-foreground font-mono text-[11px] flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                      {new Date(err.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-6 py-4 font-mono text-foreground">{err.endpoint}</td>
                    <td className="px-6 py-4">
                      <Badge variant="outline" className="border-none bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400 font-bold text-[11px]">
                        {err.status} ERROR
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{err.business}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
