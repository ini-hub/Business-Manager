import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Receipt,
  CreditCard,
  Calendar,
  AlertTriangle,
  Building,
  Clock,
  ArrowUpRight,
  TrendingUp,
  Percent,
  CheckCircle,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Ban,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function TransactionsMonitor() {
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("all");

  // Query central ledger stream
  const { data: ledgerData, isLoading: ledgerLoading, error: ledgerError } = useQuery({
    queryKey: ["/api/admin/transactions"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/transactions");
      return res.json();
    },
  });

  // Query anomaly flagged transactions
  const { data: flaggedData, isLoading: flaggedLoading } = useQuery({
    queryKey: ["/api/admin/transactions/flagged"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/transactions/flagged");
      return res.json();
    },
  });

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatDate = (dateStr: string) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(dateStr));
  };

  // Filter central ledger client-side for dynamic interaction
  const filteredLedger = ledgerData?.transactions?.filter((tx: any) => {
    const matchesSearch =
      tx.reference.toLowerCase().includes(search.toLowerCase()) ||
      tx.business.toLowerCase().includes(search.toLowerCase());
    const matchesMethod = method === "all" || tx.paymentMethod.toLowerCase() === method.toLowerCase();
    return matchesSearch && matchesMethod;
  }) || [];

  return (
    <div className="space-y-6 font-sans">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight font-outfit">Transactions Ledger</h1>
        <p className="text-slate-400 text-sm mt-1">Audit platform-wide transaction ledger streams and intercept flagged anomaly metrics.</p>
      </div>

      <Tabs defaultValue="ledger" className="space-y-6">
        <TabsList className="bg-slate-900 border border-slate-800 rounded-2xl p-1 gap-1">
          <TabsTrigger value="ledger" className="rounded-xl text-xs font-bold data-[state=active]:bg-slate-800 data-[state=active]:text-white">Central Ledger Stream</TabsTrigger>
          <TabsTrigger value="flagged" className="rounded-xl text-xs font-bold data-[state=active]:bg-slate-800 data-[state=active]:text-white flex items-center gap-1.5">
            Anomalous Flagged Intercepts
            {flaggedData?.flagged && flaggedData.flagged.length > 0 && (
              <Badge className="bg-rose-500 text-white border-none h-4 w-4 rounded-full flex items-center justify-center p-0 text-[9px] font-bold">
                {flaggedData.flagged.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Ledger Stream Tab */}
        <TabsContent value="ledger" className="space-y-6 animate-in fade-in duration-300">
          {/* Query Filters */}
          <div className="bg-slate-900/40 backdrop-blur border border-slate-800/80 rounded-3xl p-6 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Search Receipt / Company</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <Input
                  type="text"
                  placeholder="Receipt ref, company name..."
                  className="bg-slate-950/60 border-slate-800 text-white pl-9 rounded-xl focus:border-emerald-500/80"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Payment Gateway</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="bg-slate-950/60 border-slate-800 text-white rounded-xl focus:border-emerald-500/80">
                  <SelectValue placeholder="All Methods" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-300">
                  <SelectItem value="all">All Gateways</SelectItem>
                  <SelectItem value="cash">Cash Checkout</SelectItem>
                  <SelectItem value="transfer">Bank Transfer</SelectItem>
                  <SelectItem value="pos">Card POS Terminal</SelectItem>
                  <SelectItem value="flutterwave">Flutterwave Gateway</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              className="border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white rounded-xl h-11"
              onClick={() => {
                setSearch("");
                setMethod("all");
              }}
            >
              Reset Filters
            </Button>
          </div>

          {/* Table */}
          {ledgerLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
            </div>
          ) : ledgerError || !ledgerData ? (
            <div className="p-6 bg-rose-500/15 border border-rose-500/20 rounded-2xl text-rose-300 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>Error compiling ledger stream. Verify database connection.</span>
            </div>
          ) : filteredLedger.length === 0 ? (
            <div className="text-center py-16 bg-slate-900/20 border border-slate-800/80 rounded-3xl">
              <Receipt className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <h3 className="font-bold text-white text-base">No Transaction Ledger Records</h3>
              <p className="text-xs text-slate-500 mt-1">Adjust search parameters or check administrative sync intervals.</p>
            </div>
          ) : (
            <div className="bg-slate-900/40 backdrop-blur border border-slate-800/80 rounded-3xl overflow-hidden shadow-xl animate-in fade-in duration-300">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/40 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-6 py-4">Receipt Reference</th>
                      <th className="px-6 py-4">Business Store Location</th>
                      <th className="px-6 py-4 font-mono">Checkout Timing</th>
                      <th className="px-6 py-4 text-right">Receipt Value</th>
                      <th className="px-6 py-4">Payment Method</th>
                      <th className="px-6 py-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-xs font-semibold text-slate-300">
                    {filteredLedger.map((tx: any) => (
                      <tr key={tx.id} className="hover:bg-slate-900/20 transition-colors">
                        <td className="px-6 py-4 font-mono font-bold text-white">
                          {tx.reference}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Building className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                            <span className="text-slate-200">{tx.business}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 font-mono text-[10px] text-slate-500">
                          {formatDate(tx.date)}
                        </td>
                        <td className="px-6 py-4 text-right font-mono font-bold text-emerald-400">
                          {formatCurrency(tx.total)}
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant="outline" className="border-none font-bold uppercase text-[9px] bg-slate-800 text-slate-400">
                            {tx.paymentMethod}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            variant="outline"
                            className={`border-none font-bold uppercase text-[9px] ${
                              tx.status === "Void"
                                ? "bg-rose-500/10 text-rose-400"
                                : tx.status === "completed"
                                ? "bg-emerald-500/10 text-emerald-400"
                                : "bg-amber-500/10 text-amber-400"
                            }`}
                          >
                            {tx.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Flagged Anomaly monitor */}
        <TabsContent value="flagged" className="space-y-6 animate-in fade-in duration-300">
          {flaggedLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
            </div>
          ) : !flaggedData?.flagged || flaggedData.flagged.length === 0 ? (
            <div className="text-center py-16 bg-slate-900/20 border border-slate-800/80 rounded-3xl">
              <ShieldCheck className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
              <h3 className="font-bold text-white text-base">Ledger Shield Active</h3>
              <p className="text-xs text-slate-500 mt-1">Outstanding! All checkout parameters conform cleanly to platform standards.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {flaggedData.flagged.map((f: any, idx: number) => {
                let anomalyIcon = AlertTriangle;
                let colorClass = "text-rose-400 border-rose-500/20 bg-rose-500/5 hover:border-rose-500/30";

                if (f.flag === "Unusually large") {
                  anomalyIcon = ArrowUpRight;
                } else if (f.flag === "High discount") {
                  anomalyIcon = Percent;
                } else if (f.flag === "Round number") {
                  anomalyIcon = TrendingUp;
                } else if (f.flag === "Rapid void" || f.flag === "Zero-cost item") {
                  anomalyIcon = Ban;
                }

                const Icon = anomalyIcon;

                return (
                  <Card key={idx} className={`bg-slate-900/40 border-slate-800/80 rounded-3xl overflow-hidden transition-all duration-300 shadow-xl flex flex-col justify-between ${colorClass}`}>
                    <CardHeader className="bg-slate-950/20 p-4 border-b border-slate-800/40 flex flex-row items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className="h-4 w-4 shrink-0" />
                        <CardTitle className="text-sm font-extrabold text-white truncate font-mono">{f.reference}</CardTitle>
                      </div>
                      <Badge variant="outline" className="bg-rose-500/10 text-rose-400 border-none text-[9px] font-bold uppercase shrink-0">
                        {f.flag}
                      </Badge>
                    </CardHeader>
                    <CardContent className="p-5 space-y-4 text-xs font-semibold text-slate-300 flex-1 flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="p-3 bg-slate-950/60 border border-slate-850 rounded-2xl text-[11px] text-slate-400 leading-relaxed font-medium">
                          <span className="font-bold text-white block mb-0.5">Anomaly Trigger:</span>
                          "{f.trigger}"
                        </div>

                        <div className="space-y-1.5 pt-1">
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-slate-500 flex items-center gap-1">
                              <Building className="h-3 w-3" />
                              Store Location
                            </span>
                            <span className="text-slate-300 truncate max-w-[150px]">{f.business}</span>
                          </div>
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-slate-500 flex items-center gap-1">
                              <CreditCard className="h-3 w-3" />
                              Receipt Total
                            </span>
                            <span className="text-emerald-400 font-mono font-bold">{formatCurrency(f.total)}</span>
                          </div>
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-slate-500 flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              Checkout timing
                            </span>
                            <span className="text-slate-500 font-mono">{formatDate(f.date).substring(0, 11)}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
