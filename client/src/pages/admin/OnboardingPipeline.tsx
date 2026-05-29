import { useQuery } from "@tanstack/react-query";
import {
  GitMerge,
  AlertTriangle,
  User,
  Mail,
  Calendar,
  Building,
  TrendingUp,
  MapPin,
  ChevronRight,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

export default function OnboardingPipeline() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/admin/onboarding/pipeline"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/onboarding/pipeline");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400 mx-auto" />
          <p className="text-slate-400 text-sm font-medium">Analyzing registration funnel pipelines...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 bg-rose-500/10 border border-rose-500/20 rounded-3xl text-rose-300 max-w-xl mx-auto flex gap-4">
        <AlertCircle className="h-8 w-8 shrink-0" />
        <div>
          <h3 className="font-bold text-white">Funnel Telemetry Offline</h3>
          <p className="text-sm mt-1">Failed to query funnel stage aggregates. Please verify database synchronization.</p>
        </div>
      </div>
    );
  }

  const { funnel, stuckBusinesses } = data;

  // Calculate total organizations in funnel
  const totalOrgs =
    funnel.registered.count +
    funnel.configured.count +
    funnel.staffed.count +
    funnel.first_sale.count +
    funnel.active.count;

  const getPercent = (count: number) => {
    if (totalOrgs === 0) return 0;
    return Math.round((count / totalOrgs) * 100);
  };

  const formatDate = (dateStr: string) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(dateStr));
  };

  const stages = [
    { key: "registered", name: "1. Registered", description: "Created Account", color: "text-indigo-400", bg: "bg-indigo-500/10" },
    { key: "configured", name: "2. Configured", description: "Added Location", color: "text-blue-400", bg: "bg-blue-500/10" },
    { key: "staffed", name: "3. Staffed", description: "Uploaded Inventory", color: "text-pink-400", bg: "bg-pink-500/10" },
    { key: "first_sale", name: "4. First Sale", description: "Oboarded Staff", color: "text-amber-400", bg: "bg-amber-500/10" },
    { key: "active", name: "5. Active Business", description: "Completed Checkouts", color: "text-emerald-400", bg: "bg-emerald-500/10" },
  ];

  return (
    <div className="space-y-8 font-sans">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight font-outfit">Onboarding Funnel</h1>
        <p className="text-slate-400 text-sm mt-1">
          Monitor merchant onboarding conversions, identify drop-offs, and assist stuck accounts.
        </p>
      </div>

      {/* Funnel Flowchart Progress */}
      <div className="bg-slate-900/40 backdrop-blur border border-slate-800/80 rounded-3xl p-6 md:p-8">
        <h3 className="text-sm font-extrabold text-white uppercase tracking-wider mb-6 flex items-center gap-2">
          <GitMerge className="h-5 w-5 text-emerald-400" />
          Funnel Stage Conversions
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 relative">
          {stages.map((stage, idx) => {
            const dataStage = funnel[stage.key];
            const percent = getPercent(dataStage.count);

            return (
              <div key={stage.key} className="relative flex flex-col justify-between p-5 bg-slate-950/40 border border-slate-800/80 rounded-2xl group hover:border-slate-700/80 transition-all duration-300">
                <div className="space-y-1">
                  <span className={`text-xs font-extrabold uppercase tracking-wider ${stage.color}`}>
                    {stage.name}
                  </span>
                  <span className="block text-[10px] text-slate-500 leading-none">{stage.description}</span>
                </div>
                <div className="mt-8 flex items-baseline justify-between">
                  <span className="text-3xl font-black text-white font-mono">{dataStage.count}</span>
                  <Badge variant="outline" className={`border-none font-bold text-[10px] ${stage.bg} ${stage.color}`}>
                    {percent}%
                  </Badge>
                </div>
                {/* Arrow decorations between stages (desktop) */}
                {idx < 4 && (
                  <div className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 z-10 p-1 bg-slate-900 border border-slate-800 rounded-full">
                    <ChevronRight className="h-3 w-3 text-slate-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Stuck Funnel Pipelines Alerts */}
      {stuckBusinesses && stuckBusinesses.length > 0 && (
        <div className="bg-slate-900/30 border border-slate-800 rounded-3xl p-6">
          <h3 className="text-sm font-extrabold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Stuck Onboarding pipelines (Stagnant &gt; 48 hours)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {stuckBusinesses.map((org: any) => (
              <Card key={org.id} className="bg-slate-950/60 border-slate-800 hover:border-amber-500/30 transition-all duration-300 overflow-hidden shadow-lg rounded-2xl flex flex-col justify-between">
                <CardHeader className="bg-slate-900/40 p-4 flex flex-row items-center justify-between gap-3 border-b border-slate-800/40">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Building className="h-4 w-4 text-slate-400 shrink-0" />
                    <CardTitle className="text-sm font-extrabold text-white truncate">{org.name}</CardTitle>
                  </div>
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-none text-[9px] font-bold uppercase shrink-0">
                    {org.stage}
                  </Badge>
                </CardHeader>
                <CardContent className="p-4 space-y-4 text-xs font-semibold text-slate-300 flex-1 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[10px] text-slate-500">
                      <span>STUCK FOR</span>
                      <span className="font-bold text-amber-400">{org.stuckDuration}</span>
                    </div>
                    <div className="p-2.5 bg-slate-900/40 border border-slate-800/50 rounded-xl text-[10px] text-slate-400 leading-relaxed font-medium">
                      <span className="font-bold text-white block mb-0.5">Bottleneck:</span>
                      "{org.reason}"
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800/40 space-y-2">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-slate-500 flex items-center gap-1">
                        <User className="h-3 w-3" />
                        Merchant
                      </span>
                      <span className="text-slate-300 truncate max-w-[150px]">{org.owner.name}</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-slate-500 flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        Email
                      </span>
                      <span className="text-slate-400 truncate max-w-[150px] select-all font-mono">{org.owner.email}</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-slate-500 flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Registered
                      </span>
                      <span className="text-slate-400 font-mono">{formatDate(org.createdAt)}</span>
                    </div>
                  </div>
                </CardContent>
                <div className="px-4 pb-4 shrink-0">
                  <Link href={`/super-admin/businesses/${org.id}`}>
                    <button className="w-full py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl text-[10px] font-bold text-white transition-colors cursor-pointer">
                      Assist Merchant &amp; Audit Profile
                    </button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Stage Drilldowns Details List */}
      <div className="space-y-4">
        <h3 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-emerald-400" />
          Detailed Funnel Pipelines
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {stages.map((stage) => {
            const dataStage = funnel[stage.key];
            return (
              <div key={stage.key} className="space-y-3">
                <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800 p-3 rounded-2xl">
                  <span className="text-xs font-bold text-white">{stage.name.replace(/[0-9.\s]+/g, "")}</span>
                  <Badge variant="outline" className={`border-none font-bold text-[10px] ${stage.bg} ${stage.color}`}>
                    {dataStage.count}
                  </Badge>
                </div>

                <div className="space-y-2 max-h-[350px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
                  {dataStage.items.length === 0 ? (
                    <div className="text-center py-8 text-[10px] text-slate-600 italic bg-slate-950/20 border border-slate-900 rounded-2xl">
                      Empty stage
                    </div>
                  ) : (
                    dataStage.items.map((org: any) => (
                      <div
                        key={org.id}
                        className="p-3 bg-slate-900/20 border border-slate-900 rounded-2xl hover:border-slate-800 transition-colors"
                      >
                        <Link href={`/super-admin/businesses/${org.id}`}>
                          <span className="block font-bold text-slate-200 text-xs truncate hover:text-white cursor-pointer hover:underline">
                            {org.name}
                          </span>
                        </Link>
                        <span className="block text-[9px] text-slate-500 font-mono mt-1">
                          Reg: {formatDate(org.createdAt)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
