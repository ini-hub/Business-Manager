import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ShieldCheck, ShieldX, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function VerifyPayslipPage() {
  const [, params] = useRoute("/verify/payslip/:id");
  const id = params?.id ?? "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/verify/payslip", id],
    queryFn: async () => {
      const res = await fetch(`/api/verify/payslip/${id}`);
      if (!res.ok) throw new Error("not found");
      return res.json();
    },
    enabled: !!id,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className="flex justify-center">
              <ShieldX className="h-14 w-14 text-destructive" />
            </div>
            <h1 className="text-xl font-bold text-destructive">Payslip Not Found</h1>
            <p className="text-sm text-muted-foreground">
              This document ID does not match any payslip in our records. It may be invalid,
              expired, or the document may have been tampered with.
            </p>
            <p className="text-xs text-muted-foreground font-mono break-all">{id}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const staffName: string = data.staff?.name ?? "Unknown";
  const storeName: string = data.store?.name ?? "—";
  const period = data.period
    ? `${format(parseISO(data.period.startDate), "MMM d, yyyy")} – ${format(parseISO(data.period.endDate), "MMM d, yyyy")}`
    : "—";
  const generatedAt = data.generatedAt
    ? format(parseISO(data.generatedAt), "MMM d, yyyy 'at' h:mm a")
    : "—";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="max-w-md w-full shadow-lg">
        {/* Header band */}
        <div className="rounded-t-lg bg-[#1a2350] px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-green-400 shrink-0" />
            <div>
              <p className="text-xs text-blue-200 uppercase tracking-wide font-medium">Verified Document</p>
              <h1 className="text-lg font-bold leading-tight">Original Payslip</h1>
            </div>
          </div>
        </div>

        <CardContent className="pt-6 pb-6 space-y-5">
          {/* Verified badge */}
          <div className="flex justify-center">
            <Badge className="bg-green-100 text-green-800 border-green-300 text-sm px-4 py-1">
              Authentic &amp; Verified
            </Badge>
          </div>

          {/* Key details */}
          <div className="divide-y rounded-lg border overflow-hidden text-sm">
            <Row label="Staff" value={staffName} />
            <Row label="Store / Branch" value={storeName} />
            <Row label="Pay Period" value={period} />
            <Row label="Gross Pay" value={data.grossPay != null ? formatMoney(Number(data.grossPay)) : "—"} />
            <Row label="Net Pay" value={data.netPay != null ? formatMoney(Number(data.netPay)) : "—"} highlight />
            <Row label="Document Generated" value={generatedAt} />
          </div>

          {/* Doc ID */}
          <div className="text-center space-y-1">
            <p className="text-xs text-muted-foreground">Document ID</p>
            <p className="font-mono text-xs text-foreground break-all">{id}</p>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            This record was registered at the time the payslip was generated and cannot be altered.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex justify-between items-center px-4 py-2.5 ${highlight ? "bg-green-50" : "bg-white"}`}>
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`font-medium text-sm ${highlight ? "text-green-700" : ""}`}>{value}</span>
    </div>
  );
}

function formatMoney(amount: number) {
  return `NGN ${amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
