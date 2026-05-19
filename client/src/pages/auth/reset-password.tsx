import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, ArrowLeft, KeyRound, Eye, EyeOff, CheckCircle2 } from "lucide-react";

// Password policy validator
const validatePassword = (password: string) => {
  return {
    minLength: password.length >= 8,
    hasUpper: /[A-Z]/.test(password),
    hasLower: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password),
  };
};

const resetPasswordSchema = z.object({
  emailOrPhone: z.string().min(1, "Identifier is required"),
  otp: z.string().length(6, "OTP must be exactly 6 digits").regex(/^\d+$/, "OTP must only contain numbers"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

export default function ResetPassword() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(useSearch());
  const emailOrPhone = searchParams.get("emailOrPhone") || searchParams.get("email") || "";
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  const form = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      emailOrPhone: emailOrPhone,
      otp: "",
      password: "",
      confirmPassword: "",
    },
  });

  const password = form.watch("password") || "";
  const pwdPolicy = validatePassword(password);

  const resetMutation = useMutation({
    mutationFn: async (data: ResetPasswordFormData) => {
      const response = await apiRequest("POST", "/api/auth/verify-otp", {
        emailOrPhone: data.emailOrPhone,
        otp: data.otp,
        newPassword: data.password,
      });
      return response.json();
    },
    onSuccess: () => {
      setResetSuccess(true);
      toast({
        title: "Password reset success!",
        description: "Your password has been reset. You can now log in.",
      });
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.error || "Invalid or expired OTP code.";
      toast({
        title: "Reset failed",
        description: errorMsg,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ResetPasswordFormData) => {
    const passes = Object.values(pwdPolicy).every(Boolean);
    if (!passes) {
      toast({
        title: "Invalid password",
        description: "Your password does not meet the security checklist requirements.",
        variant: "destructive",
      });
      return;
    }
    resetMutation.mutate(data);
  };

  if (resetSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/50 p-4">
        <Card className="w-full max-w-md relative">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="h-6 w-6 text-blue-500" />
            </div>
            <CardTitle className="text-2xl font-bold">
              Password Reset Successful!
            </CardTitle>
            <CardDescription>
              Your password has been reset successfully. You can now sign in with your new password.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Link href="/auth/login" className="w-full">
              <Button className="w-full" data-testid="button-login">
                Sign In
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (!emailOrPhone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/50 p-4">
        <Card className="w-full max-w-md relative">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold text-destructive">Invalid Request</CardTitle>
            <CardDescription>
              No identifier was provided for password reset.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Link href="/auth/forgot-password" className="w-full">
              <Button className="w-full" data-testid="button-forgot-password">
                Request Password Reset
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/50 p-4">
      <Card className="w-full max-w-md relative">
        <Link href="/auth/forgot-password" className="absolute left-4 top-4">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <CardHeader className="text-center pt-12">
          <div className="mx-auto w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center mb-4">
            <KeyRound className="h-6 w-6 text-blue-500" />
          </div>
          <CardTitle className="text-2xl font-bold">
            Reset Password
          </CardTitle>
          <CardDescription>
            Enter the 6-digit code and create a new password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="otp"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reset OTP Code</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        placeholder="000000"
                        className="text-center text-2xl tracking-widest"
                        autoComplete="one-time-code"
                        data-testid="input-otp"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="Create a strong password"
                          className="pr-10"
                          data-testid="input-password"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:bg-transparent"
                          onClick={() => setShowPassword(!showPassword)}
                          data-testid="button-toggle-password"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </FormControl>
                    
                    {/* Password Policy Checklist */}
                    <div className="mt-2 space-y-1.5 p-3 rounded-md bg-muted/40 border text-xs">
                      <p className="font-semibold text-foreground mb-1">Password Checklist</p>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        {pwdPolicy.minLength ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0 ml-1.5 mr-1" />
                        )}
                        <span className={pwdPolicy.minLength ? "text-emerald-600 dark:text-emerald-400 font-medium" : ""}>At least 8 characters</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        {pwdPolicy.hasUpper ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0 ml-1.5 mr-1" />
                        )}
                        <span className={pwdPolicy.hasUpper ? "text-emerald-600 dark:text-emerald-400 font-medium" : ""}>One uppercase letter (A-Z)</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        {pwdPolicy.hasLower ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0 ml-1.5 mr-1" />
                        )}
                        <span className={pwdPolicy.hasLower ? "text-emerald-600 dark:text-emerald-400 font-medium" : ""}>One lowercase letter (a-z)</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        {pwdPolicy.hasNumber ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0 ml-1.5 mr-1" />
                        )}
                        <span className={pwdPolicy.hasNumber ? "text-emerald-600 dark:text-emerald-400 font-medium" : ""}>One number (0-9)</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        {pwdPolicy.hasSpecial ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0 ml-1.5 mr-1" />
                        )}
                        <span className={pwdPolicy.hasSpecial ? "text-emerald-600 dark:text-emerald-400 font-medium" : ""}>One special character (@,#,$...)</span>
                      </div>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm New Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder="Confirm new password"
                          className="pr-10"
                          data-testid="input-confirm-password"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:bg-transparent"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          data-testid="button-toggle-confirm-password"
                        >
                          {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full"
                disabled={resetMutation.isPending}
                data-testid="button-reset"
              >
                {resetMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  "Reset Password"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardContent className="pt-0">
          <p className="text-sm text-center w-full text-muted-foreground">
            Remember your password?{" "}
            <Link href="/auth/login" className="text-blue-500 hover:underline" data-testid="link-login">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
