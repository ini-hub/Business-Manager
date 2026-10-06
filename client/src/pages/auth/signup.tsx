import { AuthShell } from "@/components/auth-shell";
import { ChangeEmailForm, EmailOtpForm, otpIssueFromCode, type OtpIssue } from "@/components/email-otp-form";
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { deduplicatedCountryCodes, validatePhoneNumber } from "@/lib/phone-utils";
import { legalDocHref } from "@/lib/legal-docs";
import { Spinner } from "@/components/ui/loader";

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
  .refine((val) => /[^A-Za-z0-9]/.test(val), "Must include at least one special character")
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
  // Only meaningful when documents exist - the useEffect below sets this to
  // true automatically when the list is empty (nothing to agree to).
  acceptedLegalTerms: z.boolean().refine((v) => v === true, {
    message: "You must agree to all of the documents below to continue",
  }),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type SignupFormData = z.infer<typeof signupSchema>;

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
    // No published documents (and the list has finished loading) means
    // there is nothing to consent to - don't block signup on it.
    const allChecked = legalDocsQuery.isSuccess && legalDocs.every((d) => acceptedDocs[d.documentType]);
    form.setValue("acceptedLegalTerms", allChecked, { shouldValidate: hasInteractedWithConsent });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptedDocs, legalDocs.length, legalDocsQuery.isSuccess]);

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

  const [otpIssue, setOtpIssue] = useState<{ kind: OtpIssue; message: string; attemptsLeft?: number } | null>(null);
  const [verified, setVerified] = useState(false);

  const verifyOtpMutation = useMutation({
    mutationFn: async (otpVal: string) => {
      const response = await apiRequest("POST", "/api/auth/verify-signup-email", {
        emailOrPhone: verifyEmail,
        otp: otpVal,
      });
      return response.json();
    },
    // The session is already set; the user query is refreshed on "Go to my
    // dashboard" so the verified screen isn't replaced by the app first.
    onSuccess: () => setVerified(true),
    onError: (error: any) => {
      const message = error?.message || "Unable to verify email.";
      setOtpIssue({ kind: otpIssueFromCode(error?.code), message, attemptsLeft: error?.attemptsLeft });
    },
  });

  const [changingEmail, setChangingEmail] = useState(false);
  const changeEmailMutation = useMutation({
    mutationFn: async (vars: { newEmail: string; password: string }) => {
      const response = await apiRequest("POST", "/api/auth/change-signup-email", {
        currentEmail: verifyEmail,
        ...vars,
      });
      return response.json() as Promise<{ email: string }>;
    },
    onSuccess: (data) => {
      setOtpIssue(null);
      setChangingEmail(false);
      setVerifyEmail(data.email);
      toast({ title: "Code sent", description: `We sent a new code to ${data.email}.` });
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
      setOtpIssue(null);
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

  if (verifyEmail) {
    return (
      <AuthShell variant="signup">
        <div className="ks-card">
          {!verified && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVerifyEmail(null)}
              data-testid="button-back-signup"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          )}
          {changingEmail ? (
            <ChangeEmailForm
              currentEmail={verifyEmail}
              busy={changeEmailMutation.isPending}
              error={changeEmailMutation.error ? (changeEmailMutation.error as Error).message : null}
              onSubmit={(newEmail, password) => changeEmailMutation.mutate({ newEmail, password })}
              onCancel={() => { changeEmailMutation.reset(); setChangingEmail(false); }}
            />
          ) : (
          <EmailOtpForm
            key={verifyEmail}
            email={verifyEmail}
            verifying={verifyOtpMutation.isPending}
            resending={resendOtpMutation.isPending}
            issue={otpIssue?.kind ?? null}
            issueMessage={otpIssue?.message}
            attemptsLeft={otpIssue?.attemptsLeft}
            verified={verified}
            onSubmit={(code) => verifyOtpMutation.mutate(code)}
            onResend={() => resendOtpMutation.mutate()}
            onEdit={() => setOtpIssue(null)}
            onExpired={() => setOtpIssue((cur) => cur ?? { kind: "expired", message: "" })}
            onChangeEmail={() => setChangingEmail(true)}
            onContinue={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
              setLocation("/");
            }}
          />
          )}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell variant="signup">
      <Card className="ks-card">
        <CardHeader className="ks-head p-0">
          <CardTitle className="ks-title">Create your account</CardTitle>
          <CardDescription className="ks-sub">
            Set up your business and start managing everything in one place.
          </CardDescription>
        </CardHeader>
        <CardContent className="ks-content p-0">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="ks-form space-y-3">
              <div className="ks-stack">
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

              <div className="ks-stack">
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
                    <FormItem className="ks-address">
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

              <div className="ks-phone">
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

              <div className="ks-stack">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem className="ks-late">
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
                    <FormItem className="ks-late">
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
                  className="p-3 text-xs space-y-1"
                />
              )}

              <FormField
                control={form.control}
                name="acceptedLegalTerms"
                render={() => (
                  <FormItem>
                    <div className="space-y-2">
                      {legalDocsQuery.isLoading && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Spinner className="h-3.5 w-3.5 animate-spin" />
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
                    <Spinner className="mr-2 h-5 w-5 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  "Create Account"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="ks-foot p-0">
          <p className="text-sm text-center text-muted-foreground w-full">
            Already have an account?{" "}
            <Link href="/auth/login" data-testid="link-login">
              Log in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </AuthShell>
  );
}
