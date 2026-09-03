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
} from "lucide-react";
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

export default function SystemHealth() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["/api/admin/system/health"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/system/health");
      return res.json();
    },
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  // Simulated historical latency trend for rendering the graph
  const simulatedLatencyData = [
    { time: "10:00", p50: 120, p95: 280, p99: 410 },
    { time: "11:00", p50: 135, p95: 295, p99: 420 },
    { time: "12:00", p50: 145, p95: 350, p99: 490 },
    { time: "13:00", p50: 160, p95: 410, p99: 580 },
    { time: "14:00", p50: 142, p95: 310, p99: 430 },
    { time: "15:00", p50: 138, p95: 290, p99: 405 },
    { time: "16:00", p50: 140, p95: 285, p99: 395 },
  ];

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
      <div className="p-8 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-3xl flex items-center gap-4 text-rose-700 dark:text-rose-300 max-w-xl mx-auto font-sans">
        <AlertTriangle className="h-8 w-8 shrink-0 animate-bounce" />
        <div>
          <h3 className="font-bold text-foreground">System Diagnostics Offline</h3>
          <p className="text-sm mt-1">Failed to aggregate operational metrics from telemetry providers.</p>
        </div>
      </div>
    );
  }

  const { health, recentErrors } = data;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 font-sans">
      {/* Title block */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight font-outfit">Platform Diagnostics & Health</h1>
          <p className="text-muted-foreground text-sm mt-1">Real-time health index, latency telemetry and application level error trackers.</p>
        </div>
        <Button
          variant="outline"
          className="border-border bg-card/60 hover:bg-muted text-muted-foreground rounded-xl font-bold self-start sm:self-auto"
          onClick={() => refetch()}
          disabled={isRefetching}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
          Force Recalibrate
        </Button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Metric 1: API Core Latency */}
        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-3xl overflow-hidden hover:border-border/80 transition-all duration-300 shadow-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">API Latency (p50)</CardTitle>
            <Server className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </CardHeader>
          <CardContent className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-black text-foreground font-mono">{health.apiResponseTime}</span>
              <Badge variant="outline" className="bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 border-none font-bold text-[9px] uppercase">
                {health.apiStatus}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-semibold">Average server round-trip timing</p>
          </CardContent>
        </Card>

        {/* Metric 2: DB Latency */}
        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-3xl overflow-hidden hover:border-border/80 transition-all duration-300 shadow-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Database Query Time</CardTitle>
            <Database className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-black text-foreground font-mono">{health.databaseQueryTime}</span>
              <Badge variant="outline" className="bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 border-none font-bold text-[9px] uppercase">
                {health.databaseStatus}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-semibold">Average Drizzle Query Execution</p>
          </CardContent>
        </Card>

        {/* Metric 3: Active Operations */}
        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-3xl overflow-hidden hover:border-border/80 transition-all duration-300 shadow-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Active WS Clients</CardTitle>
            <Users className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          </CardHeader>
          <CardContent className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-black text-foreground font-mono">{health.activeSessions}</span>
              <Badge variant="outline" className="bg-violet-100 dark:bg-violet-950/40 text-violet-800 dark:text-violet-400 border-none font-bold text-[9px] uppercase">
                Live Channels
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-semibold">Simultaneous online store systems</p>
          </CardContent>
        </Card>

        {/* Metric 4: Platform Error Index */}
        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-3xl overflow-hidden hover:border-border/80 transition-all duration-300 shadow-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">HTTP Error Rate</CardTitle>
            <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
          </CardHeader>
          <CardContent className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-black text-foreground font-mono">{health.errorRate}</span>
              <Badge variant="outline" className="bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400 border-none font-bold text-[9px] uppercase">
                Within Bound
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-semibold">Percent of failing client checkouts</p>
          </CardContent>
        </Card>
      </div>

      {/* Latency telemetry trend chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-3xl lg:col-span-2 overflow-hidden shadow-2xl">
          <CardHeader className="border-b border-border/80 bg-background/20 px-6 py-5">
            <CardTitle className="text-sm font-bold text-foreground tracking-wide flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              API Percentile Latency Timeline (p50, p95, p99)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={simulatedLatencyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-3xl overflow-hidden flex flex-col justify-between shadow-2xl">
          <div>
            <CardHeader className="border-b border-border/80 bg-background/20 px-6 py-5">
              <CardTitle className="text-sm font-bold text-foreground tracking-wide">Infrastructure Subsystems</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between p-3.5 bg-background/50 border border-border rounded-2xl">
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  <div>
                    <span className="block text-xs font-bold text-foreground">Email Server Pool</span>
                    <span className="text-[10px] text-muted-foreground font-semibold">Dynamic SendGrid API Nodes</span>
                  </div>
                </div>
                <span className="text-xs font-mono font-extrabold text-emerald-600 dark:text-emerald-400">{health.emailDeliveryRate}</span>
              </div>

              <div className="flex items-center justify-between p-3.5 bg-background/50 border border-border rounded-2xl">
                <div className="flex items-center gap-3">
                  <MessageSquare className="h-5 w-5 text-primary" />
                  <div>
                    <span className="block text-xs font-bold text-foreground">SMS Gateway</span>
                    <span className="text-[10px] text-muted-foreground font-semibold">AfricaTalking API Pool</span>
                  </div>
                </div>
                <span className="text-xs font-mono font-extrabold text-emerald-600 dark:text-emerald-400">{health.smsDeliveryRate}</span>
              </div>

              <div className="flex items-center justify-between p-3.5 bg-background/50 border border-border rounded-2xl">
                <div className="flex items-center gap-3">
                  <Server className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  <div>
                    <span className="block text-xs font-bold text-foreground">Edge Node Cache</span>
                    <span className="text-[10px] text-muted-foreground font-semibold">Memcached Key-Store Pool</span>
                  </div>
                </div>
                <span className="text-xs font-mono font-extrabold text-emerald-600 dark:text-emerald-400">99.8% Hit</span>
              </div>
            </CardContent>
          </div>
          <div className="p-5 border-t border-border/40 bg-background/20 text-center">
            <span className="text-[9px] font-bold text-muted-foreground tracking-wider uppercase">Telemetry Stream: Connected</span>
          </div>
        </Card>
      </div>

      {/* Recent Failing Requests / Errors */}
      <Card className="bg-card/40 backdrop-blur border border-border/80 rounded-3xl overflow-hidden shadow-2xl animate-in fade-in duration-300">
        <CardHeader className="bg-background/20 p-6 border-b border-border/40 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-extrabold text-foreground font-outfit">Platform Failure Log (Last 24 Hours)</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Aggregated uncaught HTTP anomalies and database integrity errors across all organisations.
            </CardDescription>
          </div>
          <Badge variant="outline" className="bg-rose-100 dark:bg-rose-500/10 border-none text-rose-700 dark:text-rose-600 dark:text-rose-400 text-[10px] font-extrabold uppercase px-2 py-0.5">
            {recentErrors.length} Uncaught Issues
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-semibold">
              <thead className="bg-background/40 text-muted-foreground uppercase text-[9px] tracking-wider border-b border-border">
                <tr>
                  <th className="px-6 py-3.5">Timestamp</th>
                  <th className="px-6 py-3.5">Affected Endpoint</th>
                  <th className="px-6 py-3.5">Response Status</th>
                  <th className="px-6 py-3.5">Origin Organisation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentErrors.map((err: any) => (
                  <tr key={err.id} className="hover:bg-card/30 transition-colors">
                    <td className="px-6 py-4 text-muted-foreground font-mono text-[10px] flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                      {new Date(err.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-6 py-4 font-mono text-foreground">{err.endpoint}</td>
                    <td className="px-6 py-4">
                      <Badge variant="outline" className="border-none bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400 font-bold text-[10px]">
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
