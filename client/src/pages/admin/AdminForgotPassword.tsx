import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Shield, MailCheck, ArrowLeft, RefreshCw } from "lucide-react";
import { validateEmail } from "@/lib/validation-utils";

export default function AdminForgotPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailCheck = validateEmail(email);
    if (!emailCheck.valid) {
      toast({ title: "Invalid Email", description: emailCheck.error, variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      await apiRequest("POST", "/api/admin/auth/forgot-password", { email: email.trim() });
      setSubmitted(true);
    } catch (err: any) {
      toast({
        title: "Request Failed",
        description: err?.message || "Could not process the reset request.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 overflow-hidden font-sans">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />

      <div className="w-full max-w-md p-8 relative z-10">
        <div className="text-center mb-8 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="inline-flex items-center justify-center p-3 bg-slate-900/60 border border-slate-800 rounded-2xl mb-4 shadow-xl">
            <Shield className="h-10 w-10 text-emerald-400 animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white font-outfit">Business Manager</h1>
          <p className="text-sm text-slate-400 mt-1">Super Admin Operations Center</p>
        </div>

        <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-500">
          {submitted ? (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center p-2.5 bg-slate-950/60 border border-slate-800 rounded-xl">
                <MailCheck className="h-6 w-6 text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Check Your Inbox</h3>
              <p className="text-sm text-slate-400">
                If an administrative account exists for <strong className="text-slate-300">{email}</strong>, a 6-digit reset code has been sent. The code expires in 10 minutes.
              </p>
              <Button
                className="w-full py-6 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold transition-all duration-300"
                onClick={() => setLocation(`/super-admin/reset-password?email=${encodeURIComponent(email.trim())}`)}
              >
                Enter Reset Code
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="text-center mb-2">
                <h3 className="text-lg font-semibold text-white">Reset Admin Password</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Enter your administrative email to receive a one-time reset code.
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Admin Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@businessmanager.com"
                  className="bg-slate-950/60 border-slate-800 text-white placeholder-slate-600 focus:border-emerald-500/80 focus:ring-emerald-500/20 transition-all rounded-xl py-6"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full py-6 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/20 active:scale-[0.98]"
              >
                {loading ? <RefreshCw className="h-5 w-5 animate-spin" /> : "Send Reset Code"}
              </Button>

              <Link href="/super-admin/login" className="flex items-center justify-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Sign In
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
