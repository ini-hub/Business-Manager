import { KowopeBrand } from "@/components/kowope-brand";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput, PasswordChecklist } from "@/components/ui/password-input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, ArrowLeft, ExternalLink } from "lucide-react";
import { deduplicatedCountryCodes, validatePhoneNumber } from "@/lib/phone-utils";
import { legalDocHref } from "@/lib/legal-docs";

interface LegalDocumentSummary {
  documentType: string;
  title: string;
  versionNumber: number;
}

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .refine((val) => /[A-Z]/.test(val), "Must include at least one uppercase letter")
  .refine((val) => /[a-z]/.test(val), "Must include at least one lowercase letter")
  .refine((val) => /[!@#$%^&*(),.?":{}|<>]/.test(val), "Must include at least one special character")
  .refine((val) => !/\s/.test(val), "Password cannot contain spaces");

const signupSchema = z.object({
  ownerName: z.string().min(1, "Your name is required").transform(s => s.trim()),
  businessName: z.string().min(1, "Business name is required").transform(s => s.trim()),
  address: z.string().optional(),
  phoneCountryCode: z.string().default("+234"),
  phone: z.string().optional(),
  email: z.string().email("Please enter a valid email address"),
  password: passwordSchema,
  confirmPassword: z.string(),
  // Mirrors shared/schema/auth.ts's signupSchema.acceptedLegalTerms - the
  // server re-validates this independently, this is just what keeps the
  // submit button disabled until it's checked. z.boolean().refine rather
  // than z.literal(true) so the field's TS type is `boolean`, not the
  // literal `true` - a checkbox's defaultValue has to be able to start false.
  // Deliberately doesn't name specific documents here (this schema is
  // static at module-load time, so it can't reflect whatever a super admin
  // has added/archived since) - the checkboxes below individually name
  // whichever documents currently exist.
  acceptedLegalTerms: z.boolean().refine((v) => v === true, {
    message: "You must agree to all of the documents below to continue",
  }),
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
      ownerName: "",
      businessName: "",
      address: "",
      phoneCountryCode: "+234",
      phone: "",
      email: "",
      password: "",
      confirmPassword: "",
      acceptedLegalTerms: false,
    },
  });

  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);
  const [otp, setOtp] = useState("");

  // Whatever documents currently exist - the three seeded defaults, plus
  // any section a super admin has added since (LegalDocuments.tsx). One
  // individual checkbox per document below, all of which must be checked
  // to enable the acceptedLegalTerms form field.
  const legalDocsQuery = useQuery<{ documents: LegalDocumentSummary[] }>({
    queryKey: ["/api/legal"],
  });
  const legalDocs = legalDocsQuery.data?.documents ?? [];
  const [acceptedDocs, setAcceptedDocs] = useState<Record<string, boolean>>({});
  // Only true once the user has clicked at least one consent checkbox -
  // gates shouldValidate below so the "You must agree..." error doesn't
  // render the instant the document list loads (setValue(..., false) is
  // still needed at that point to keep the field itself false, just without
  // eagerly validating and populating formState.errors before anyone has
  // touched the checkboxes).
  const [hasInteractedWithConsent, setHasInteractedWithConsent] = useState(false);

  useEffect(() => {
    const allChecked = legalDocs.length > 0 && legalDocs.every((d) => acceptedDocs[d.documentType]);
    form.setValue("acceptedLegalTerms", allChecked, { shouldValidate: hasInteractedWithConsent });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptedDocs, legalDocs.length]);

  const password = form.watch("password");

  const signupMutation = useMutation({
    mutationFn: async (data: SignupFormData & { acceptedDocumentTypes: string[] }) => {
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
      if (error.code === "LEGAL_DOCUMENTS_STALE") {
        // The document set changed while this form was open (a super admin
        // archived/reactivated/added a section) - refetch so the checkboxes
        // reflect what's actually current now, and make the user re-check
        // them rather than silently resubmitting with the stale set.
        queryClient.invalidateQueries({ queryKey: ["/api/legal"] });
        setAcceptedDocs({});
        setHasInteractedWithConsent(false);
      }
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
    if (data.phone) {
      const phoneCheck = validatePhoneNumber(data.phone, data.phoneCountryCode);
      if (!phoneCheck.valid) {
        form.setError("phone", { message: phoneCheck.error });
        return;
      }
    }
    // The exact documents this form actually rendered checkboxes for and
    // got checked - not just "all boxes are ticked" (acceptedLegalTerms).
    // Server-validated against what's current at submit time (see
    // LegalDocumentService.recordAcceptance) so a document
    // archived/reactivated/added while this form was open can't be recorded
    // as accepted (or silently skipped) without the user ever seeing it.
    const acceptedDocumentTypes = legalDocs
      .filter((doc) => acceptedDocs[doc.documentType])
      .map((doc) => doc.documentType);
    signupMutation.mutate({ ...data, acceptedDocumentTypes });
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
    // h-screen + overflow-hidden, not min-h-screen: the whole point is to
    // fit on one screen without scrolling. max-h-full overflow-y-auto on
    // the Card below is a pure safety net for viewports too short even for
    // the compact layout (e.g. a narrow browser window with dev tools open)
    // - it shouldn't ever trigger on a normal desktop/laptop viewport.
    <div className="h-screen overflow-hidden flex items-center justify-center bg-gradient-to-b from-[hsl(214,25%,96%)] to-[hsl(210,15%,92%)] dark:from-[hsl(214,22%,6%)] dark:to-[hsl(214,22%,9%)] p-3">
      <Card className="w-full max-w-2xl relative max-h-full overflow-y-auto">
        <Link href="/" className="absolute left-3 top-3 z-10">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back
          </Button>
        </Link>
        <CardHeader className="text-center pt-8 pb-2 space-y-1.5">
          <div className="flex justify-center">
            <KowopeBrand />
          </div>
          <CardTitle className="text-xl">Create your account</CardTitle>
          <CardDescription className="text-xs">
            Kowope Business Management System — set up your business and start managing everything in one place
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-2">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <FormField
                  control={form.control}
                  name="ownerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Your Full Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Amaka Johnson"
                          autoComplete="name"
                          data-testid="input-owner-name"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

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
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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
              </div>

              <div className="grid grid-cols-3 gap-2.5">
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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
              </div>

              {password && (
                <PasswordChecklist
                  password={password}
                  confirmPassword={form.watch("confirmPassword")}
                  className="p-2.5 text-xs space-y-1"
                />
              )}

              <FormField
                control={form.control}
                name="acceptedLegalTerms"
                render={() => (
                  <FormItem>
                    <div className="space-y-1.5">
                      {legalDocsQuery.isLoading && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Loading agreements...
                        </div>
                      )}
                      {legalDocs.map((doc) => (
                        <div key={doc.documentType} className="flex items-start gap-2">
                          <Checkbox
                            checked={!!acceptedDocs[doc.documentType]}
                            onCheckedChange={(checked) => {
                              setHasInteractedWithConsent(true);
                              setAcceptedDocs((prev) => ({ ...prev, [doc.documentType]: !!checked }));
                            }}
                            data-testid={`checkbox-accept-${doc.documentType}`}
                            className="mt-0.5"
                          />
                          <label className="font-normal text-xs text-muted-foreground leading-snug cursor-pointer select-none">
                            I have read and agree to the{" "}
                            <a
                              href={legalDocHref(doc.documentType)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline font-medium text-foreground hover:text-primary inline-flex items-center gap-1"
                              data-testid={`link-open-${doc.documentType}`}
                            >
                              {doc.title}
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          </label>
                        </div>
                      ))}
                    </div>
                    {/* Gated on interaction, not just rendered unconditionally: with a
                        zod schema resolver + mode "onChange", RHF re-validates the whole
                        schema (and populates formState.errors for every field, not just
                        the one being edited) on every keystroke anywhere in the form -
                        without this gate, this error rendered from the moment the
                        document list loaded, before the user had touched anything. */}
                    {hasInteractedWithConsent && <FormMessage />}
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
        <CardFooter className="pt-0 pb-4">
          <p className="text-xs text-center text-muted-foreground w-full">
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
