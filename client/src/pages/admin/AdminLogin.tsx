import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Shield, KeyRound, ArrowRight, RefreshCw } from "lucide-react";
import { validateEmail } from "@/lib/validation-utils";

export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");

  // MFA setup values (returned if MFA not yet configured)
  const [mfaConfigured, setMfaConfigured] = useState(true);
  const [qrUrl, setQrUrl] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [tempToken, setTempToken] = useState("");

  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({ title: "Missing Fields", description: "Please enter both administrative email and password.", variant: "destructive" });
      return;
    }
    const emailCheck = validateEmail(email);
    if (!emailCheck.valid) {
      toast({ title: "Invalid Email", description: emailCheck.error, variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/admin/auth/login", {
        email: email.trim(),
        password,
      });
      const data = await res.json();

      if (data.mfaRequired) {
        setTempToken(data.tempToken);
        setMfaConfigured(data.mfaConfigured);
        if (!data.mfaConfigured) {
          setQrUrl(data.qrUrl || "");
          setMfaSecret(data.mfaSecret || "");
        }
        setStep(2);
      } else {
        // Fallback (though schema / auth-admin makes MFA mandatory)
        toast({
          title: "Access Denied",
          description: "MFA is mandatory for administrative access.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      const errMsg = err?.message || "Invalid administrative credentials.";
      toast({
        title: "Authentication Failed",
        description: errMsg,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpCode || totpCode.length !== 6) {
      toast({
        title: "Invalid Code",
        description: "Please enter the 6-digit MFA verification code.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/admin/auth/verify-mfa", {
        tempToken,
        code: totpCode,
      });

      if (res.ok) {
        toast({
          title: "Access Granted",
          description: "Welcome to the Platform Super Admin Portal.",
        });
        // Clear query cache and hard redirect to load dashboard
        window.location.href = "/super-admin";
      } else {
        throw new Error("Invalid verification code.");
      }
    } catch (err: any) {
      const errMsg = err?.message || "Invalid or expired verification code.";
      toast({
        title: "Verification Failed",
        description: errMsg,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 overflow-hidden font-sans">
      {/* Decorative Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />

      <div className="w-full max-w-md p-8 relative z-10">
        <div className="text-center mb-8 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="inline-flex items-center justify-center p-3 bg-slate-900/60 border border-slate-800 rounded-2xl mb-4 shadow-xl">
            <Shield className="h-10 w-10 text-emerald-400 animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white font-outfit">
            Business Manager
          </h1>
          <p className="text-sm text-slate-400 mt-1">Super Admin Operations Center</p>
        </div>

        <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-500">
          {step === 1 ? (
            <form onSubmit={handleStep1Submit} className="space-y-5">
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
                <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Access Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••••••"
                  className="bg-slate-950/60 border-slate-800 text-white placeholder-slate-600 focus:border-emerald-500/80 focus:ring-emerald-500/20 transition-all rounded-xl py-6"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full py-6 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/20 active:scale-[0.98]"
              >
                {loading ? (
                  <RefreshCw className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    Sign In to Console
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleStep2Submit} className="space-y-6">
              <div className="text-center mb-4">
                <div className="inline-flex items-center justify-center p-2.5 bg-slate-950/60 border border-slate-800 rounded-xl mb-3">
                  <KeyRound className="h-6 w-6 text-emerald-400" />
                </div>
                <h3 className="text-lg font-semibold text-white">MFA Authentication</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Secure operation credentials require a secondary 6-digit TOTP key.
                </p>
              </div>

              {!mfaConfigured && qrUrl && (
                <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800/80 flex flex-col items-center space-y-4 animate-in fade-in slide-in-from-bottom-2">
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest">
                    First-Time MFA Registration
                  </span>
                  
                  {/* Since we can't easily display a SVG QR code natively without qrcode.react,
                      let's display the text key in a beautiful copyable element and give a placeholder visual */}
                  <div className="w-40 h-40 bg-white p-2 rounded-xl flex items-center justify-center relative overflow-hidden shadow-inner">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrUrl)}`}
                      alt="Authenticator QR Code"
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        // fallback if external API is unreachable
                        (e.target as HTMLElement).style.display = "none";
                      }}
                    />
                  </div>
                  
                  <div className="text-center space-y-1 w-full">
                    <p className="text-[10px] text-slate-400">Can't scan the code? Enter this secret manually:</p>
                    <code className="block p-2 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono text-emerald-300 select-all tracking-wider break-all">
                      {mfaSecret}
                    </code>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="totp" className="text-xs font-semibold uppercase tracking-wider text-slate-400 block text-center mb-2">
                  6-Digit Authenticator Code
                </Label>
                <Input
                  id="totp"
                  type="text"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  className="bg-slate-950/60 border-slate-800 text-white placeholder-slate-600 focus:border-emerald-500/80 focus:ring-emerald-500/20 transition-all rounded-xl py-6 text-center font-mono text-2xl tracking-[0.4em] pl-6"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9]/g, ""))}
                  disabled={loading}
                />
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 py-6 rounded-xl border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
                  onClick={() => setStep(1)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading}
                  className="flex-[2] py-6 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold transition-all duration-300"
                >
                  {loading ? <RefreshCw className="h-5 w-5 animate-spin" /> : "Verify Identity"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
