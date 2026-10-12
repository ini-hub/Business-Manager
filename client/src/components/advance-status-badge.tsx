import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface StatusFields {
  isRecovered?: boolean;
  recoveryStatus?: string;
  status?: string;
  outstandingBalance?: number | string;
}

// Single source for how an advance's state reads, shared by the list and the
// detail page.
export function AdvanceStatusBadge({ advance: a, fmt }: { advance: StatusFields; fmt: (v: number) => string }) {
  if (a.isRecovered) return <Badge variant="outline" className="text-emerald-700 bg-emerald-50 dark:bg-emerald-950 border-emerald-200 gap-1"><Check className="h-3 w-3" /> Recovered</Badge>;
  // Too big for one payroll period: part of it was already collected, the rest
  // carries forward on this same advance and is proposed again automatically.
  if (a.recoveryStatus === "partial") return <Badge variant="outline" className="text-amber-700 bg-amber-50 dark:bg-amber-950 border-amber-200">Partial — {fmt(Number(a.outstandingBalance))} left</Badge>;
  if (a.status === "rejected") return <Badge variant="outline" className="text-red-700 bg-red-50 dark:bg-red-950 border-red-200">Rejected</Badge>;
  if (a.status === "approved") return <Badge variant="outline" className="text-blue-700 bg-blue-50 dark:bg-blue-950 border-blue-200">Approved</Badge>;
  return <Badge variant="outline" className="text-amber-700 bg-amber-50 dark:bg-amber-950 border-amber-200">Pending Approval</Badge>;
}
