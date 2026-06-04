import { KowopeBrand } from "@/components/kowope-brand";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, ArrowLeft, AlertCircle } from "lucide-react";
import { validateEmailOrPhone } from "@/lib/validation-utils";
import { Checkbox } from "@/components/ui/checkbox";
import { PasswordInput, PasswordChecklist } from "@/components/ui/password-input";

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

export default function Login() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<
    "identifier" | "password" | "activation_code" | "create_password" | "verify_otp" | "org_select" | "almost_there"
  >("identifier");
  const [identifier, setIdentifier] = useState("");
  const [isPasswordValid, setIsPasswordValid] = useState(false);
  const [stayLoggedIn, setStayLoggedIn] = useState(false);
  const [lockoutMsg, setLockoutMsg] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  
  // Custom activation code states
  const [activationCodeVal, setActivationCodeVal] = useState("");
  const [actCodeTouched, setActCodeTouched] = useState(false);
  const [actCodeError, setActCodeError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  // Org selection state
  const [orgs, setOrgs] = useState<{ id: string; name: string; slug: string; role: string }[]>([]);
  const [tempUserId, setTempUserId] = useState<string | null>(null);

  // Form schemas
  const identifierSchema = z.object({
    emailOrPhone: z.string().min(1, "Email or phone number is required").refine(validateEmailOrPhone, "Enter a valid email address or phone number."),
  });

  const passwordFormSchema = z.object({
    password: z.string().min(1, "Password is required"),
  });

  const actPasswordSchema = z
    .string()
    .min(8, "Password must be at least 8 characters")
    .refine((val) => /[A-Z]/.test(val), "Must include at least one uppercase letter")
    .refine((val) => /[a-z]/.test(val), "Must include at least one lowercase letter")
    .refine((val) => /[0-9]/.test(val), "Must include at least one number")
    .refine((val) => /[^A-Za-z0-9]/.test(val), "Must include at least one special character")
    .refine((val) => !/\s/.test(val), "Password cannot contain spaces");

  const activationCodeFormSchema = z.object({
    activationCode: z.string().min(1, "Activation code is required"),
  });

  const createPasswordFormSchema = z.object({
    password: actPasswordSchema,
    confirmPassword: z.string().min(1, "Confirm password is required"),
  }).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

  const idForm = useForm({
    resolver: zodResolver(identifierSchema),
    defaultValues: { emailOrPhone: "" },
  });

  const passForm = useForm({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { password: "" },
  });

  const actCodeForm = useForm({
    resolver: zodResolver(activationCodeFormSchema),
    defaultValues: { activationCode: "" },
  });

  const createPassForm = useForm({
    resolver: zodResolver(createPasswordFormSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const createPasswordValue = createPassForm.watch("password") || "";

  // Step 1: Check user identity
  const checkIdentityMutation = useMutation({
    mutationFn: async (emailOrPhone: string) => {
      const response = await apiRequest("POST", "/api/auth/continue", { emailOrPhone });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.status === "not_found") {
        toast({
          title: "Account not found",
          description: "This identifier is not registered. Please sign up.",
          variant: "destructive",
        });
      } else if (data.status === "locked") {
        setLockoutMsg(data.error);
        toast({
          title: "Account locked",
          description: data.error,
          variant: "destructive",
        });
      } else if (data.status === "email_verification_required") {
        setStep("verify_otp");
        toast({
          title: "Email verification required",
          description: "Please enter the 6-digit OTP code sent to your email to continue.",
        });
      } else if (data.status === "pending_activation") {
        setStep("activation_code");
        toast({
          title: "Account Pending Activation",
          description: data.message || "Please enter your invitation activation code.",
        });
      } else if (data.status === "create_password_required") {
        setStep("almost_there");
        toast({
          title: "Almost there!",
          description: data.message || "You have verified your code. Create your password to finish setting up.",
        });
      } else {
        setStep("password");
      }
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.error || "Unable to check identifier.";
      toast({
        title: "Error",
        description: errorMsg,
        variant: "destructive",
      });
    },
  });

  // Step 2: Login with password
  const loginMutation = useMutation({
    mutationFn: async (password: string) => {
      const response = await apiRequest("POST", "/api/auth/login", {
        emailOrPhone: identifier,
        password,
        stayLoggedIn,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.status === "email_verification_required") {
        setStep("verify_otp");
        toast({
          title: "Email verification required",
          description: "Please enter the 6-digit OTP code sent to your email to continue.",
        });
      } else if (data.requiresOrganisationSelection) {
        setOrgs(data.organisations);
        setTempUserId(data.userId);
        setStep("org_select");
        toast({
          title: "Multiple Workspaces Found",
          description: "Please select the organisation you want to access.",
        });
      } else {
        toast({
          title: "Welcome back!",
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        setLocation("/");
      }
    },
    onError: (error: any) => {
      const errorData = error.response?.data || error;
      toast({
        title: "Login failed",
        description: errorData.error || "Invalid password",
        variant: "destructive",
      });
    },
  });

  // Step 3: Select Org Workspace
  const selectOrgMutation = useMutation({
    mutationFn: async (organisationId: string) => {
      const response = await apiRequest("POST", "/api/auth/organisation/select", {
        userId: tempUserId,
        organisationId,
        stayLoggedIn,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Logged in successfully",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.error || "Workspace entry failed.";
      toast({
        title: "Workspace entry failed",
        description: errorMsg,
        variant: "destructive",
      });
    },
  });

  // Verify Activation Code
  const verifyCodeMutation = useMutation({
    mutationFn: async (activationCode: string) => {
      setActCodeError(null);
      const response = await apiRequest("POST", "/api/auth/activate", {
        emailOrPhone: identifier,
        activationCode,
      });
      return response.json();
    },
    onSuccess: () => {
      setStep("create_password");
      toast({
        title: "Code Verified!",
        description: "Please create a secure password for your account.",
      });
    },
    onError: (error: any) => {
      const errMsg = error.message || "Invalid activation code";
      setActCodeError(errMsg);
      toast({
        title: "Verification failed",
        description: errMsg,
        variant: "destructive",
      });
    },
  });

  // Set Activated Password
  const setPasswordMutation = useMutation({
    mutationFn: async (password: string) => {
      const response = await apiRequest("POST", "/api/auth/set-activated-password", {
        emailOrPhone: identifier,
        password,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Password Set Successfully!",
        description: "Welcome to Kowope.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    },
    onError: (error: any) => {
      const errorData = error.response?.data || error;
      toast({
        title: "Error",
        description: errorData.error || "Unable to set password.",
        variant: "destructive",
      });
    },
  });

  // Verify Email OTP
  const verifyOtpMutation = useMutation({
    mutationFn: async (otpVal: string) => {
      const response = await apiRequest("POST", "/api/auth/verify-signup-email", {
        emailOrPhone: identifier,
        otp: otpVal,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Email Verified!",
        description: "Welcome back to Kowope.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    },
    onError: (error: any) => {
      const errorData = error.response?.data || error;
      toast({
        title: "Verification failed",
        description: errorData.error || "Invalid OTP code",
        variant: "destructive",
      });
    },
  });

  // Resend Email OTP
  const resendOtpMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/resend-verification-otp", {
        emailOrPhone: identifier,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Code Sent!",
        description: "A fresh verification code has been sent to your email.",
      });
    },
    onError: (error: any) => {
      const errorData = error.response?.data || error;
      toast({
        title: "Error",
        description: errorData.error || "Unable to resend code.",
        variant: "destructive",
      });
    },
  });

  // Resend Activation Code
  const resendActivationMutation = useMutation({
    mutationFn: async () => {
      setActCodeError(null);
      const response = await apiRequest("POST", "/api/auth/resend-activation", {
        emailOrPhone: identifier,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data?.nextStep === "create-password") {
        setStep("almost_there");
        toast({
          title: "Almost there!",
          description: data.message || "You have already verified your activation code. Let's create your password.",
        });
        return;
      }
      setResendCooldown(60);
      toast({
        title: "Activation Code Sent!",
        description: "A new invitation activation code has been sent to your email.",
      });
    },
    onError: (error: any) => {
      const errorData = error.response?.data || error;
      const errMsg = errorData.message || errorData.error || "Unable to resend activation code.";
      setActCodeError(errMsg);
      toast({
        title: "Resend failed",
        description: errMsg,
        variant: "destructive",
      });
    },
  });

  const onIdentifierSubmit = (data: { emailOrPhone: string }) => {
    setIdentifier(data.emailOrPhone);
    checkIdentityMutation.mutate(data.emailOrPhone);
  };

  const onPasswordSubmit = (data: { password: string }) => {
    loginMutation.mutate(data.password);
  };

  const onVerifyCodeSubmit = (data: { activationCode: string }) => {
    verifyCodeMutation.mutate(data.activationCode);
  };

  const onCreatePasswordSubmit = (data: z.infer<typeof createPasswordFormSchema>) => {
    if (!isPasswordValid) {
      toast({
        title: "Invalid password",
        description: "Your password does not meet the security checklist requirements.",
        variant: "destructive",
      });
      return;
    }
    setPasswordMutation.mutate(data.password);
  };

  const handleVerifyOtpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim() || otp.trim().length !== 6) {
      toast({
        title: "Invalid code",
        description: "Please enter a valid 6-digit OTP code.",
        variant: "destructive",
      });
      return;
    }
    verifyOtpMutation.mutate(otp.trim());
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-[hsl(214,25%,96%)] to-[hsl(210,15%,92%)] dark:from-[hsl(214,22%,6%)] dark:to-[hsl(214,22%,9%)] p-4 gap-5">
      <KowopeBrand />
      <Card className="w-full max-w-md relative">
        {step !== "identifier" && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute left-4 top-4"
            onClick={() => {
              if (step === "org_select") setStep("password");
              else setStep("identifier");
            }}
            data-testid="button-back-step"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        )}

        <CardHeader className="text-center pt-12">
          <CardTitle className="text-2xl">
            {step === "identifier" ? "Sign in to Kowope" : "Welcome back"}
          </CardTitle>
          <CardDescription>
            {step === "identifier" && "Kowope Business Management System — enter your email or phone to continue"}
            {step === "password" && `Enter your password for ${identifier}`}
            {step === "verify_otp" && `Verify your email address for ${identifier}`}
            {step === "activation_code" && `Activate your staff invitation for ${identifier}`}
            {step === "create_password" && `Create a password for ${identifier}`}
            {step === "almost_there" && `Complete your Kowope registration for ${identifier}`}
            {step === "org_select" && "Select the business workspace you want to access"}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Identity Step */}
          {step === "identifier" && (
            <Form {...idForm}>
              <form onSubmit={idForm.handleSubmit(onIdentifierSubmit)} className="space-y-4">
                <FormField
                  control={idForm.control}
                  name="emailOrPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email or Phone Number</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="name@gmail.com or +234..."
                          data-testid="input-identifier"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={checkIdentityMutation.isPending}
                  data-testid="button-continue"
                >
                  {checkIdentityMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    "Continue"
                  )}
                </Button>
              </form>
            </Form>
          )}

          {/* Password Step */}
          {step === "password" && (
            <Form {...passForm}>
              <form onSubmit={passForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
                 <FormField
                   control={passForm.control}
                   name="password"
                   render={({ field }) => (
                     <FormItem>
                       <FormLabel>Password</FormLabel>
                       <FormControl>
                         <PasswordInput
                           placeholder="Enter password"
                           data-testid="input-password"
                           {...field}
                         />
                       </FormControl>
                       <FormMessage />
                     </FormItem>
                   )}
                 />

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="stay-logged-in"
                      checked={stayLoggedIn}
                      onCheckedChange={(checked) => setStayLoggedIn(!!checked)}
                    />
                    <label htmlFor="stay-logged-in" className="text-xs text-muted-foreground cursor-pointer select-none">
                      Stay logged in for 30 days
                    </label>
                  </div>
                  <Link href="/auth/forgot-password" className="text-xs text-blue-500 hover:underline" data-testid="link-forgot-password">
                    Forgot password?
                  </Link>
                </div>

                {lockoutMsg && (
                  <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 text-destructive p-2.5 rounded-md text-xs">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{lockoutMsg}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={loginMutation.isPending}
                  data-testid="button-login"
                >
                  {loginMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>
            </Form>
          )}

          {/* Org Select Step */}
          {step === "org_select" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground text-center">
                Select organisation workspace to log in to:
              </p>
              {orgs.map((org) => (
                <Button
                  key={org.id}
                  variant="outline"
                  className="w-full flex justify-between items-center py-6"
                  onClick={() => selectOrgMutation.mutate(org.id)}
                  disabled={selectOrgMutation.isPending}
                  data-testid={`button-org-select-${org.slug}`}
                >
                  <span className="font-semibold">{org.name}</span>
                  <span className="text-xs text-muted-foreground capitalize bg-muted px-2.5 py-1 rounded">
                    {org.role}
                  </span>
                </Button>
              ))}
            </div>
          )}

          {/* Activation Code Step */}
          {step === "activation_code" && (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  verifyCodeMutation.mutate(activationCodeVal);
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <label htmlFor="act-code-input" className="text-sm font-medium text-foreground">
                    Invitation Activation Code
                  </label>
                  <Input
                    id="act-code-input"
                    placeholder="e.g. ABCD-EFGH"
                    value={activationCodeVal}
                    onChange={(e) => {
                      const val = e.target.value;
                      const clean = val.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
                      let formatted = clean;
                      if (clean.length > 4) {
                        formatted = clean.slice(0, 4) + "-" + clean.slice(4);
                      }
                      setActivationCodeVal(formatted);
                      setActCodeError(null);
                    }}
                    onBlur={() => {
                      setActCodeTouched(true);
                      const clean = activationCodeVal.replace(/[^A-Za-z0-9]/g, "");
                      if (clean.length > 0 && clean.length < 8) {
                        setActCodeError("Please enter your full 8-character activation code");
                      }
                    }}
                    data-testid="input-activation-code"
                    className="text-center text-lg tracking-widest font-mono uppercase"
                  />
                  {actCodeError && (
                    <div className="flex items-start gap-2 text-destructive mt-1 rounded text-xs" data-testid="error-activation-code">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{actCodeError}</span>
                    </div>
                  )}
                  {!actCodeError && actCodeTouched && activationCodeVal.replace(/[^A-Za-z0-9]/g, "").length < 8 && (
                    <div className="flex items-start gap-2 text-destructive mt-1 rounded text-xs">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>Please enter your full 8-character activation code</span>
                    </div>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={activationCodeVal.replace(/[^A-Za-z0-9]/g, "").length !== 8 || verifyCodeMutation.isPending}
                  data-testid="button-verify-code"
                >
                  {verifyCodeMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    "Verify Code"
                  )}
                </Button>
              </form>

              <div className="text-sm text-muted-foreground text-center pt-2 border-t mt-4">
                Didn't receive a code or it expired?{" "}
                <button
                  type="button"
                  className="p-0 h-auto font-normal text-primary hover:underline bg-transparent border-0 cursor-pointer disabled:opacity-50"
                  onClick={() => resendActivationMutation.mutate()}
                  disabled={resendCooldown > 0 || resendActivationMutation.isPending}
                  data-testid="button-resend-activation"
                >
                  {resendActivationMutation.isPending ? (
                    "Resending..."
                  ) : resendCooldown > 0 ? (
                    `Resend in ${resendCooldown}s`
                  ) : (
                    "Resend Activation Code"
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Almost There Step */}
          {step === "almost_there" && (
            <div className="space-y-6 py-4 text-center">
              <div className="space-y-3">
                <h3 className="text-xl font-semibold text-foreground tracking-tight">Almost there</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
                  You have already verified your activation code. You just need to create your password to finish setting up your account.
                </p>
              </div>
              <Button
                className="w-full mt-4 font-medium"
                onClick={() => setStep("create_password")}
              >
                Create My Password &rarr;
              </Button>
            </div>
          )}

          {/* Create Password Step */}
          {step === "create_password" && (
            <Form {...createPassForm}>
              <form onSubmit={createPassForm.handleSubmit(onCreatePasswordSubmit)} className="space-y-4">
                <FormField
                  control={createPassForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Create Password</FormLabel>
                      <FormControl>
                        <PasswordInput
                          placeholder="Create password"
                          data-testid="input-act-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {createPasswordValue && (
                  <div className="mt-2">
                    <PasswordChecklist
                      password={createPasswordValue}
                      confirmPassword={createPassForm.watch("confirmPassword")}
                      onValidationChange={setIsPasswordValid}
                    />
                  </div>
                )}

                <FormField
                  control={createPassForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <PasswordInput
                          placeholder="Confirm password"
                          data-testid="input-confirm-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={setPasswordMutation.isPending}
                  data-testid="button-set-password"
                >
                  {setPasswordMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Setting Password...
                    </>
                  ) : (
                    "Create Password & Login"
                  )}
                </Button>
              </form>
            </Form>
          )}

          {/* Verify OTP Step */}
          {step === "verify_otp" && (
            <div className="space-y-4">
              <form onSubmit={handleVerifyOtpSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="otp-input" className="text-sm font-medium text-foreground">
                    Verification Code
                  </label>
                  <Input
                    id="otp-input"
                    placeholder="Enter 6-digit OTP"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ""))}
                    data-testid="input-otp"
                    className="text-center text-lg tracking-widest font-mono"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={verifyOtpMutation.isPending}
                  data-testid="button-verify-otp"
                >
                  {verifyOtpMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    "Verify Code"
                  )}
                </Button>
              </form>
              <div className="text-sm text-muted-foreground text-center">
                Didn't receive the code?{" "}
                <button
                  type="button"
                  className="p-0 h-auto font-normal text-primary hover:underline bg-transparent border-0 cursor-pointer"
                  onClick={() => resendOtpMutation.mutate()}
                  disabled={resendOtpMutation.isPending}
                  data-testid="button-resend-otp"
                >
                  {resendOtpMutation.isPending ? "Sending..." : "Resend code"}
                </button>
              </div>
            </div>
          )}
        </CardContent>

        {step === "identifier" && (
          <CardFooter className="flex flex-col gap-2 pb-10">
            <p className="text-sm text-muted-foreground text-center">
              Don't have an account?{" "}
              <Link href="/auth/signup" className="text-blue-500 hover:underline" data-testid="link-signup">
                Sign up
              </Link>
            </p>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
