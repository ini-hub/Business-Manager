import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldAlert,
  Search,
  Eye,
  Loader2,
  AlertCircle,
  Clock,
  User,
  Activity,
  Filter,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function AuditLogs() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAction, setSelectedAction] = useState("all");
  const [selectedLog, setSelectedLog] = useState<any>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);

  // Query Audit Logs
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/admin/system/audit-logs", searchTerm, selectedAction],
    queryFn: async () => {
      let url = "/api/admin/system/audit-logs";
      const params: string[] = [];
      if (searchTerm) params.push(`search=${encodeURIComponent(searchTerm)}`);
      if (selectedAction && selectedAction !== "all") params.push(`action=${encodeURIComponent(selectedAction)}`);
      if (params.length > 0) {
        url += `?${params.join("&")}`;
      }
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const getActionBadgeColor = (action: string) => {
    switch (action) {
      case "suspend_business":
      case "delete_business":
        return "bg-rose-500/10 text-rose-450 border-rose-500/20";
      case "reactivate_business":
      case "create_super_admin":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "create_announcement":
      case "email_broadcast":
        return "bg-violet-500/10 text-violet-400 border-violet-500/20";
      case "reset_user_password":
      case "reset_mfa":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      default:
        return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
    }
  };

  return (
    <div className="space-y-6 font-sans">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight font-outfit">Operations Audit Trail</h1>
        <p className="text-slate-400 text-sm mt-1">Immutable ledger logging all administrative operations, resets, suspensions and configurations.</p>
      </div>

      {/* Filters & Search Toolbar */}
      <Card className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-5 shadow-xl">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Search by action, administrator email or target UUID..."
              className="bg-slate-950 border-slate-800 text-white rounded-xl pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex gap-3 w-full md:w-auto items-center shrink-0">
            <Filter className="h-4 w-4 text-slate-500 shrink-0 hidden sm:block" />
            <Select value={selectedAction} onValueChange={setSelectedAction}>
              <SelectTrigger className="bg-slate-950 border-slate-800 text-white rounded-xl min-w-[200px] w-full md:w-auto">
                <SelectValue placeholder="Filter by Action Type" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-slate-350">
                <SelectItem value="all">All Operations</SelectItem>
                <SelectItem value="suspend_business">suspend_business</SelectItem>
                <SelectItem value="reactivate_business">reactivate_business</SelectItem>
                <SelectItem value="reset_user_password">reset_user_password</SelectItem>
                <SelectItem value="create_announcement">create_announcement</SelectItem>
                <SelectItem value="email_broadcast">email_broadcast</SelectItem>
                <SelectItem value="create_super_admin">create_super_admin</SelectItem>
                <SelectItem value="reset_mfa">reset_mfa</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* Audit Log Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
        </div>
      ) : error || !data?.logs ? (
        <div className="p-6 bg-rose-500/15 border border-rose-500/20 rounded-2xl text-rose-300 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>Failed to compile immutable audit trail stream.</span>
        </div>
      ) : data.logs.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/20 border border-slate-800/80 rounded-3xl">
          <ShieldAlert className="h-10 w-10 text-slate-600 mx-auto mb-3" />
          <h3 className="font-bold text-white text-base">No Matching Audit Entries</h3>
          <p className="text-xs text-slate-500 mt-1">Refine your active search criteria or target filters.</p>
        </div>
      ) : (
        <Card className="bg-slate-900/40 border border-slate-800/80 rounded-3xl overflow-hidden shadow-2xl animate-in fade-in duration-300">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-semibold">
              <thead className="bg-slate-950/40 text-slate-450 uppercase text-[9px] tracking-wider border-b border-slate-850">
                <tr>
                  <th className="px-6 py-4">Timestamp</th>
                  <th className="px-6 py-4">Administrator</th>
                  <th className="px-6 py-4">Action</th>
                  <th className="px-6 py-4">Target Resource</th>
                  <th className="px-6 py-4">IP Address</th>
                  <th className="px-6 py-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850">
                {data.logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-slate-900/30 transition-colors">
                    <td className="px-6 py-4 text-slate-450 font-mono text-[10px] flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-slate-200">{log.adminEmail}</span>
                        <span className="text-[9px] text-slate-500 font-mono uppercase">{log.adminRole}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant="outline" className={`border ${getActionBadgeColor(log.action)} text-[10px] py-0.5 px-2 rounded-md font-extrabold uppercase`}>
                        {log.action}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-slate-300 truncate max-w-[200px] font-mono text-[11px]">{log.target}</td>
                    <td className="px-6 py-4 text-slate-450 font-mono">{log.ipAddress}</td>
                    <td className="px-6 py-4 text-right">
                      {log.details ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="hover:bg-slate-850 text-indigo-400 hover:text-white rounded-lg h-8"
                          onClick={() => {
                            setSelectedLog(log);
                            setShowDetailDialog(true);
                          }}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          Inspect
                        </Button>
                      ) : (
                        <span className="text-[10px] text-slate-650 italic">None</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* JSON Payload Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="bg-slate-900 border border-slate-800 text-slate-300 max-w-lg rounded-3xl p-6 font-sans">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-lg font-bold text-white font-outfit flex items-center gap-2">
              <Activity className="h-5 w-5 text-indigo-400" />
              Audit Payload Inspection
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Payload breakdown for administrative operation #{selectedLog?.id?.slice(0, 8)}.
            </DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4 my-3 text-xs leading-relaxed">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950/60 rounded-2xl border border-slate-850 text-slate-350">
                <div>
                  <span className="block text-[9px] text-slate-500 uppercase tracking-widest font-bold">Admin Email</span>
                  <span className="font-semibold text-slate-200">{selectedLog.adminEmail}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500 uppercase tracking-widest font-bold">Security Role</span>
                  <span className="font-semibold text-slate-250 font-mono text-[10px] uppercase">{selectedLog.adminRole}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500 uppercase tracking-widest font-bold">Execution Date</span>
                  <span>{new Date(selectedLog.createdAt).toLocaleString()}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500 uppercase tracking-widest font-bold">IP Coordinates</span>
                  <span className="font-mono">{selectedLog.ipAddress}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="block text-[9px] text-slate-500 uppercase tracking-widest font-bold">Payload Details (JSON)</span>
                <pre className="bg-slate-950 border border-slate-850 rounded-2xl p-4 overflow-auto max-h-[220px] font-mono text-[10px] text-indigo-400 leading-relaxed shadow-inner">
                  {JSON.stringify(JSON.parse(selectedLog.details || "{}"), null, 2)}
                </pre>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button
              className="bg-indigo-500 hover:bg-indigo-650 text-white font-bold rounded-xl px-5"
              onClick={() => setShowDetailDialog(false)}
            >
              Close Inspector
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
