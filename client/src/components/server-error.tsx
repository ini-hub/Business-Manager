import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, RefreshCw, Home, ShieldAlert, Copy, Check, LifeBuoy, Mail, Send } from "lucide-react";
import { Link } from "wouter";

interface ServerErrorProps {
  error?: string | Error;
  reset?: () => void;
}

// Simple deterministic hash function to generate user-friendly troubleshooting codes
const getErrorCode = (msg: string) => {
  let hash = 0;
  for (let i = 0; i < msg.length; i++) {
    const char = msg.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  const hex = Math.abs(hash).toString(16).toUpperCase().padStart(4, "0");
  return `ERR-BM-${hex.slice(0, 4)}`;
};

export default function ServerError({ error, reset }: ServerErrorProps) {
  const [copied, setCopied] = useState(false);
  const errorMessage = typeof error === 'string' ? error : error?.message || "An unexpected error occurred while communicating with the server.";
  
  const errorCode = getErrorCode(errorMessage);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`Error Code: ${errorCode}\nDiagnostics: ${errorMessage}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy error details:", err);
    }
  };

  const handleReportIssue = () => {
    const subject = encodeURIComponent(`Application Crash Report: [${errorCode}]`);
    const body = encodeURIComponent(
      `Hi Support Team,\n\nI encountered an application error. Here are the diagnostics:\n\n` +
      `Error Code: ${errorCode}\n` +
      `Error Message: ${errorMessage}\n` +
      `Browser Environment: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'}\n` +
      `Local Time: ${new Date().toISOString()}\n\n` +
      `Please help me resolve this issue.`
    );
    window.location.href = `mailto:bolujoexcellent@gmail.com?subject=${subject}&body=${body}`;
  };

  return (
    <div className="flex min-h-[85vh] flex-col items-center justify-center p-4 relative overflow-hidden bg-radial-gradient">
      {/* Decorative premium glowing background blobs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-destructive/10 rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-[250px] h-[250px] bg-primary/5 rounded-full blur-[60px] pointer-events-none" />

      <Card className="max-w-md w-full border-destructive/20 bg-card/65 backdrop-blur-md shadow-2xl overflow-hidden rounded-2xl relative z-10 transition-all duration-300 hover:shadow-destructive/5 hover:border-destructive/30">
        <div className="h-1.5 w-full bg-gradient-to-r from-destructive/60 via-destructive to-destructive/60" />
        <CardContent className="pt-10 pb-8 px-6 text-center space-y-6">
          {/* Animated visual representation */}
          <div className="flex justify-center">
            <div className="relative group">
              <div className="absolute inset-0 rounded-full bg-destructive/20 blur-md group-hover:blur-xl transition-all duration-300 scale-110" />
              <div className="relative rounded-full bg-gradient-to-b from-destructive/10 to-destructive/5 p-4.5 ring-4 ring-destructive/10">
                <ShieldAlert className="h-12 w-12 text-destructive animate-pulse" />
              </div>
            </div>
          </div>
          
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-b from-foreground to-foreground/80 bg-clip-text">
              Something went wrong
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
              We encountered an issue connecting to our services. This might be a temporary hiccup, but let's get you back on track.
            </p>
          </div>

          {/* Interactive, copyable error details container */}
          <div className="bg-muted/30 hover:bg-muted/40 rounded-xl p-4 text-left border border-border/40 relative group transition-colors duration-200">
            <div className="flex flex-col mb-3 pb-2 border-b border-border/40">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                Troubleshooting Code
              </span>
              <span className="text-sm font-mono font-bold text-destructive mt-0.5" data-testid="troubleshooting-code">
                {errorCode}
              </span>
            </div>

            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1.5 w-full pr-8">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
                  System Diagnostics
                </p>
                <p className="text-xs font-mono break-words leading-relaxed text-foreground/90 max-h-[120px] overflow-y-auto pr-1">
                  {errorMessage}
                </p>
              </div>
            </div>
            {/* Super premium absolute Copy Button */}
            <button
              onClick={handleCopy}
              className="absolute right-3 top-3 p-1.5 rounded-lg border border-border/50 bg-background/50 hover:bg-background text-muted-foreground hover:text-foreground transition-all duration-200 cursor-pointer"
              title="Copy diagnostics to clipboard"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-500 animate-in zoom-in" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {/* Support Helpline Card */}
          <div className="flex items-center gap-3 p-3.5 bg-primary/5 border border-primary/10 rounded-xl text-left animate-in fade-in duration-300">
            <Mail className="h-5 w-5 text-primary shrink-0" />
            <div className="space-y-0.5">
              <p className="text-xs font-bold">Need Direct Assistance?</p>
              <p className="text-[11px] text-muted-foreground">
                Email support at <span className="font-semibold text-foreground">bolujoexcellent@gmail.com</span> or report the issue below.
              </p>
            </div>
          </div>

          {/* Premium Dynamic Action Buttons */}
          <div className="flex flex-col gap-2 pt-2">
            <div className="flex flex-col gap-2.5 sm:flex-row justify-center">
              <Button 
                variant="default" 
                className="gap-2 font-medium px-5 shadow-sm group active:scale-[0.98] transition-transform duration-100 cursor-pointer flex-1"
                onClick={() => reset ? reset() : window.location.reload()}
              >
                <RefreshCw className="h-4 w-4 group-hover:rotate-45 transition-transform duration-300" />
                Try Again
              </Button>
              
              <Button 
                variant="outline"
                className="gap-2 font-medium px-5 group active:scale-[0.98] transition-transform duration-100 cursor-pointer flex-1"
                onClick={handleReportIssue}
              >
                <Send className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                Report Issue
              </Button>
            </div>

            <Button variant="ghost" asChild className="gap-2 font-medium active:scale-[0.98] transition-transform duration-100 cursor-pointer w-full mt-1">
              <Link href="/">
                <Home className="h-4 w-4 text-muted-foreground" />
                Back to Dashboard
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* Dynamic assistance note */}
      <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground animate-in fade-in slide-in-from-bottom-2 duration-700">
        <LifeBuoy className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span>Need help? Share the diagnostics above with your technical administrator.</span>
      </div>
    </div>
  );
}
