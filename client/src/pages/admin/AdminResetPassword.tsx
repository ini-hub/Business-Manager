import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput, PasswordChecklist } from "@/components/ui/password-input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Shield, KeyRound, ArrowLeft, RefreshCw, CheckCircle2 } from "lucide-react";
import { validateEmail } from "@/lib/validation-utils";

export default function AdminResetPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const searchParams = new URLSearchParams(useSearch());

  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPasswordValid, setIsPasswordValid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const emailCheck = validateEmail(email);
    if (!emailCheck.valid) {
      toast({ title: "Invalid Email", description: emailCheck.error, variant: "destructive" });
      return;
    }
    if (otp.length !== 6) {
      toast({ title: "Invalid Code", description: "Enter the 6-digit reset code sent to your email.", variant: "destructive" });
      return;
    }
    if (!isPasswordValid) {
      toast({ title: "Invalid Password", description: "Password does not meet the security checklist requirements.", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords Don't Match", description: "Confirm password must match the new password.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      await apiRequest("POST", "/api/admin/auth/reset-password", {
        email: email.trim(),
        otp,
        password,
      });
      setSuccess(true);
      toast({ title: "Password Reset", description: "Your administrative password has been reset." });
    } catch (err: any) {
      toast({
        title: "Reset Failed",
        description: err?.message || "Invalid or expired reset code.",
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
          {success ? (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center p-2.5 bg-slate-950/60 border border-slate-800 rounded-xl">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Password Reset Successfully</h3>
              <p className="text-sm text-slate-400">You can now sign in to the Super Admin Console with your new password.</p>
              <Button
                className="w-full py-6 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold transition-all duration-300"
                onClick={() => setLocation("/super-admin/login")}
              >
                Back to Sign In
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="text-center mb-2">
                <div className="inline-flex items-center justify-center p-2.5 bg-slate-950/60 border border-slate-800 rounded-xl mb-3">
                  <KeyRound className="h-6 w-6 text-emerald-400" />
                </div>
                <h3 className="text-lg font-semibold text-white">Set New Password</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Enter the 6-digit code sent to your email along with your new password.
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

              <div className="space-y-1">
                <Label htmlFor="otp" className="text-xs font-semibold uppercase tracking-wider text-slate-400 block text-center">
                  6-Digit Reset Code
                </Label>
                <Input
                  id="otp"
                  type="text"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  className="bg-slate-950/60 border-slate-800 text-white placeholder-slate-600 focus:border-emerald-500/80 focus:ring-emerald-500/20 transition-all rounded-xl py-6 text-center font-mono text-2xl tracking-[0.4em] pl-6"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ""))}
                  disabled={loading}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  New Password
                </Label>
                <PasswordInput
                  id="password"
                  placeholder="••••••••••••"
                  className="bg-slate-950/60 border-slate-800 text-white placeholder-slate-600 focus:border-emerald-500/80 focus:ring-emerald-500/20 transition-all rounded-xl py-6"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="confirmPassword" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Confirm New Password
                </Label>
                <PasswordInput
                  id="confirmPassword"
                  placeholder="••••••••••••"
                  className="bg-slate-950/60 border-slate-800 text-white placeholder-slate-600 focus:border-emerald-500/80 focus:ring-emerald-500/20 transition-all rounded-xl py-6"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                />
              </div>

              <PasswordChecklist
                password={password}
                confirmPassword={confirmPassword}
                onValidationChange={setIsPasswordValid}
                className="bg-slate-950/60 border-slate-800 text-slate-300"
              />

              <Button
                type="submit"
                disabled={loading}
                className="w-full py-6 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/20 active:scale-[0.98]"
              >
                {loading ? <RefreshCw className="h-5 w-5 animate-spin" /> : "Reset Password"}
              </Button>

              <Link href="/super-admin/forgot-password" className="flex items-center justify-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors">
                <ArrowLeft className="h-3.5 w-3.5" />
                Request a New Code
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
