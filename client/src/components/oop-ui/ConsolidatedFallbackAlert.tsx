import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Store, ArrowRight, ChevronRight, HelpCircle } from "lucide-react";

interface ConsolidatedFallbackAlertProps {
  pageTitle: string;
}

export function ConsolidatedFallbackAlert({ pageTitle }: ConsolidatedFallbackAlertProps) {
  return (
    <div className="flex items-center justify-center min-h-[450px] p-4">
      <Card className="max-w-md w-full border border-slate-750 bg-slate-900/95 shadow-2xl rounded-3xl overflow-hidden animate-in fade-in duration-300">
        <CardHeader className="text-center pb-2 pt-8">
          <div className="mx-auto h-12 w-12 rounded-full bg-amber-500/10 border border-amber-500/35 flex items-center justify-center text-amber-500 mb-4 animate-pulse">
            <Store className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-white">
            Branch Selection Required
          </CardTitle>
          <CardDescription className="text-xs text-slate-300 mt-1.5 uppercase font-bold tracking-wider">
            {pageTitle}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center px-6 pb-8 space-y-6">
          <p className="text-sm text-slate-200 leading-relaxed font-medium">
            You are currently viewing consolidated business-wide reports. POS checkout operations, supply logistics, and payroll rosters require an active physical store branch.
          </p>

          <div className="bg-slate-950/80 rounded-2xl p-5 border border-slate-800 text-left space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-300 flex items-center gap-1.5">
              <HelpCircle className="h-4 w-4 text-primary shrink-0" />
              How to Select a Store:
            </h4>
            <ul className="space-y-3.5">
              <li className="text-sm text-slate-100 font-medium flex items-start gap-2.5">
                <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary/10 text-[10px] font-bold text-primary shrink-0 border border-primary/25">
                  1
                </span>
                <span>Open the sidebar console on the left.</span>
              </li>
              <li className="text-sm text-slate-100 font-medium flex items-start gap-2.5">
                <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary/10 text-[10px] font-bold text-primary shrink-0 border border-primary/25">
                  2
                </span>
                <span>Click the active **Store Selector** dropdown.</span>
              </li>
              <li className="text-sm text-slate-100 font-medium flex items-start gap-2.5">
                <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary/10 text-[10px] font-bold text-primary shrink-0 border border-primary/25">
                  3
                </span>
                <span>Choose a physical branch (e.g., Lagos, Abuja).</span>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
