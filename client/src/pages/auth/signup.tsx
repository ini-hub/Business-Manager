import { KowopeBrand } from "@/components/kowope-brand";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput, PasswordChecklist } from "@/components/ui/password-input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, ArrowLeft } from "lucide-react";
import { deduplicatedCountryCodes } from "@/lib/phone-utils";

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .refine((val) => /[A-Z]/.test(val), "Must include at least one uppercase letter")
  .refine((val) => /[a-z]/.test(val), "Must include at least one lowercase letter")
  .refine((val) => /[!@#$%^&*(),.?":{}|<>]/.test(val), "Must include at least one special character")
  .refine((val) => !/\s/.test(val), "Password cannot contain spaces");

const signupSchema = z.object({
  businessName: z.string().min(1, "Business name is required").transform(s => s.trim()),
  address: z.string().optional(),
  phoneCountryCode: z.string().default("+234"),
  phone: z.string().optional(),
  email: z.string().email("Please enter a valid email address"),
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type SignupFormData = z.infer<typeof signupSchema>;

interface PasswordRequirement {
  label: string;
  met: boolean;
}

function getPasswordRequirements(password: string): PasswordRequirement[] {
  return [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "One uppercase letter", met: /[A-Z]/.test(password) },
    { label: "One lowercase letter", met: /[a-z]/.test(password) },
    { label: "One number", met: /[0-9]/.test(password) },
    { label: "One special character (!@#$%^&*)", met: /[!@#$%^&*(),.?":{}|<>]/.test(password) },
    { label: "No spaces", met: password.length > 0 && !/\s/.test(password) },
  ];
}

export default function Signup() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const form = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    mode: "onChange",
    defaultValues: {
      businessName: "",
      address: "",
      phoneCountryCode: "+234",
      phone: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);
  const [otp, setOtp] = useState("");

  const password = form.watch("password");

  const signupMutation = useMutation({
    mutationFn: async (data: SignupFormData) => {
      const response = await apiRequest("POST", "/api/auth/signup", data);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.status === "email_verification_required") {
        toast({
          title: "Account created!",
          description: "Please check your inbox for the 6-digit email verification OTP.",
        });
        setVerifyEmail(data.email);
      } else {
        toast({
          title: "Account created!",
          description: "You can now sign in with your credentials.",
        });
        setLocation("/auth/login");
      }
    },
    onError: (error: any) => {
      const errorMessage = error.message || error.error || "Failed to create account. Please try again.";
      toast({
        title: "Couldn't Create Account",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async (otpVal: string) => {
      const response = await apiRequest("POST", "/api/auth/verify-signup-email", {
        emailOrPhone: verifyEmail,
        otp: otpVal,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Email verified!",
        description: "Welcome to Kowope.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    },
    onError: (error: any) => {
      const errorData = error.response?.data || error;
      toast({
        title: "Verification failed",
        description: errorData.error || "Unable to verify email.",
        variant: "destructive",
      });
    },
  });

  const resendOtpMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/resend-verification-otp", {
        emailOrPhone: verifyEmail,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Code sent!",
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

  const onSubmit = (data: SignupFormData) => {
    signupMutation.mutate(data);
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

  if (verifyEmail) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-[hsl(214,25%,96%)] to-[hsl(210,15%,92%)] dark:from-[hsl(214,22%,6%)] dark:to-[hsl(214,22%,9%)] p-4 gap-5">
        <Card className="w-full max-w-md relative">
          <Button
            variant="ghost"
            size="sm"
            className="absolute left-4 top-4"
            onClick={() => setVerifyEmail(null)}
            data-testid="button-back-signup"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <CardHeader className="text-center pt-12">
            <CardTitle className="text-2xl">Verify your email</CardTitle>
            <CardDescription>
              We've sent a 6-digit OTP code to <strong className="text-foreground">{verifyEmail}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
          <CardFooter className="flex flex-col gap-4 text-center">
            <div className="text-sm text-muted-foreground text-center w-full">
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
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-[hsl(214,25%,96%)] to-[hsl(210,15%,92%)] dark:from-[hsl(214,22%,6%)] dark:to-[hsl(214,22%,9%)] p-4 gap-5">
      <KowopeBrand />
      <Card className="w-full max-w-md relative">
        <Link href="/" className="absolute left-4 top-4">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <CardHeader className="text-center pt-12">
          <CardTitle className="text-2xl">Create your account</CardTitle>
          <CardDescription>
            Kowope Business Management System — set up your business and start managing everything in one place
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="businessName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Your Business Name"
                        data-testid="input-business-name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="you@example.com"
                        autoComplete="email"
                        data-testid="input-email"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-3 gap-2">
                <FormField
                  control={form.control}
                  name="phoneCountryCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-country-code">
                            <SelectValue placeholder="+234" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {deduplicatedCountryCodes.map((country) => (
                            <SelectItem key={country.dialCode} value={country.dialCode}>
                              {country.dialCode}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Phone (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="tel"
                          placeholder="Phone number"
                          data-testid="input-phone"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Address (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="123 Business Street"
                        data-testid="input-address"
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
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <PasswordInput
                        placeholder="Create a strong password"
                        autoComplete="new-password"
                        data-testid="input-password"
                        {...field}
                      />
                    </FormControl>
                    {password && (
                      <div className="mt-2">
                        <PasswordChecklist
                          password={password}
                          confirmPassword={form.watch("confirmPassword")}
                        />
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <PasswordInput
                        placeholder="Confirm your password"
                        autoComplete="new-password"
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
                disabled={signupMutation.isPending || !form.formState.isValid}
                data-testid="button-signup"
              >
                {signupMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  "Create Account"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">

          <p className="text-sm text-center text-muted-foreground">
            Already have an account?{" "}
            <Link href="/auth/login" className="text-primary hover:underline" data-testid="link-login">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
