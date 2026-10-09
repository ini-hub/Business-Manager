import { AuthShell } from "@/components/auth-shell";
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { PasswordInput, PasswordChecklist } from "@/components/ui/password-input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AlertCircle, ArrowLeft, Check, MessageSquare, Smartphone } from "lucide-react";
import {
  deduplicatedCountryCodes,
  validatePhoneNumber,
  formatPhoneDisplay,
  normalizePhoneForStorage,
  splitNormalizedPhone,
} from "@/lib/phone-utils";
import { newPasswordSchema, normalizeEmail } from "@shared/authRules";
import { Spinner } from "@/components/ui/loader";

type Step = "request" | "code" | "password" | "done";
type Channel = "email" | "sms" | "whatsapp";

const STEP_NUMBER: Record<Step, number> = { request: 1, code: 2, password: 3, done: 4 };
const CODE_LENGTH = 6;
const RESEND_SECONDS = 30;

const emailSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter an email address like you@example.com."),
});

const phoneSchema = z
  .object({
    phoneCountryCode: z.string(),
    phone: z.string().min(1, "Phone number is required"),
  })
  .refine((d) => validatePhoneNumber(d.phone, d.phoneCountryCode).valid, {
    message: "Enter a valid phone number",
    path: ["phone"],
  });

const passwordFormSchema = z
  .object({
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "The two passwords don't match.",
    path: ["confirmPassword"],
  });

/** Where the person came from: login passes the identifier they already typed. */
function readEntry() {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const raw = params.get("identifier") ?? "";
  const phone = raw.startsWith("+") ? splitNormalizedPhone(raw) : undefined;
  return {
    raw,
    phone,
    method: (phone ? "phone" : "email") as "email" | "phone",
    // reset-password.tsx forwards old links straight to the code step
    startAtCode: params.get("step") === "code" && !!raw,
  };
}

function CodeBoxes({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? "");
  const focus = (i: number) => refs.current[Math.max(0, Math.min(CODE_LENGTH - 1, i))]?.focus();

  const setAt = (i: number, text: string) => {
    const clean = text.replace(/\D/g, "");
    const next = [...digits];
    if (!clean) {
      next[i] = "";
    } else {
      clean.slice(0, CODE_LENGTH - i).split("").forEach((ch, k) => { next[i + k] = ch; });
      focus(i + clean.length);
    }
    onChange(next.join(""));
  };
  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i]) focus(i - 1);
    else if (e.key === "ArrowLeft") focus(i - 1);
    else if (e.key === "ArrowRight") focus(i + 1);
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    setAt(0, e.clipboardData.getData("text"));
  };

  return (
    <div className="ks-code" role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <Input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid || undefined}
          maxLength={CODE_LENGTH}
          onChange={(e) => setAt(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
          data-testid={`input-otp-${i}`}
        />
      ))}
    </div>
  );
}

export default function ForgotPassword() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [entry] = useState(readEntry);

  const [step, setStep] = useState<Step>(entry.startAtCode ? "code" : "request");
  const [method, setMethod] = useState<"email" | "phone">(entry.method);
  const [identifier, setIdentifier] = useState(entry.startAtCode ? entry.raw : "");
  const [identifierDisplay, setIdentifierDisplay] = useState(() =>
    entry.startAtCode ? (entry.phone ? formatPhoneDisplay(entry.phone.localNumber, entry.phone.countryCode) : entry.raw) : "");
  const [channel, setChannel] = useState<Channel>(entry.startAtCode && !entry.raw.includes("@") ? "sms" : "email");
  // Came from the login screen: the identifier is locked, since changing it
  // here would mean resetting a different account than the one being logged into.
  const [prefilled] = useState(!!entry.raw && !entry.startAtCode);

  const [phoneChannel, setPhoneChannel] = useState<"sms" | "whatsapp">("sms");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(entry.startAtCode ? 0 : RESEND_SECONDS);
  const [isPasswordValid, setIsPasswordValid] = useState(false);
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [resetError, setResetError] = useState<string | null>(null);
  // Explanations for locked options appear only once someone tries them.
  const [lockedTabTried, setLockedTabTried] = useState(false);
  const [noTextTried, setNoTextTried] = useState(false);

  const { data: smsConfig } = useQuery<{ smsEnabled: boolean; whatsappEnabled: boolean }>({
    queryKey: ["/api/auth/platform-sms-config"],
  });
  const smsOn = !!smsConfig?.smsEnabled;
  const whatsappOn = !!smsConfig?.whatsappEnabled;
  const canTextPhone = smsOn || whatsappOn;

  // Default the phone delivery choice to whatever is actually configured.
  useEffect(() => {
    if (!smsOn && whatsappOn) setPhoneChannel("whatsapp");
  }, [smsOn, whatsappOn]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const emailForm = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: entry.method === "email" ? entry.raw : "" },
  });
  const phoneForm = useForm<z.infer<typeof phoneSchema>>({
    resolver: zodResolver(phoneSchema),
    defaultValues: {
      phoneCountryCode: entry.phone?.countryCode ?? "+234",
      phone: entry.phone?.localNumber ?? "",
    },
  });
  const passwordForm = useForm<z.infer<typeof passwordFormSchema>>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const passwordValue = passwordForm.watch("password") || "";

  const sendMutation = useMutation({
    mutationFn: async (vars: { identifier: string; channel: Channel }) => {
      const response = await apiRequest("POST", "/api/auth/forgot-password", {
        emailOrPhone: vars.identifier,
        channel: vars.channel,
      });
      return response.json();
    },
    onSuccess: (_data, vars) => {
      setIdentifier(vars.identifier);
      setChannel(vars.channel);
      setCode("");
      setCodeError(null);
      setCooldown(RESEND_SECONDS);
      setStep("code");
    },
    onError: (error: Error) => {
      toast({
        title: "Request failed",
        description: error.message || "Could not process request. Please try again.",
        variant: "destructive",
      });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/verify-otp", { emailOrPhone: identifier, otp: code });
      return response.json();
    },
    onSuccess: () => {
      setCodeError(null);
      setStep("password");
    },
    onError: (error: Error) => setCodeError(error.message || "That code is not right. Check it and try again."),
  });

  const resetMutation = useMutation({
    mutationFn: async (data: z.infer<typeof passwordFormSchema>) => {
      const response = await apiRequest("POST", "/api/auth/reset-password", {
        emailOrPhone: identifier,
        otp: code,
        password: data.password,
        confirmPassword: data.confirmPassword,
        signOutOtherDevices: signOutOthers,
      });
      return response.json();
    },
    onSuccess: () => {
      setResetError(null);
      setStep("done");
    },
    onError: (error: Error) => setResetError(error.message || "Could not reset your password. Please try again."),
  });

  const onEmailSubmit = (data: z.infer<typeof emailSchema>) => {
    const value = normalizeEmail(data.email);
    setIdentifierDisplay(value);
    sendMutation.mutate({ identifier: value, channel: "email" });
  };

  const onPhoneSubmit = (data: z.infer<typeof phoneSchema>) => {
    const value = normalizePhoneForStorage(data.phone, data.phoneCountryCode);
    setIdentifierDisplay(formatPhoneDisplay(data.phone.trim().replace(/^0+/, ""), data.phoneCountryCode));
    sendMutation.mutate({ identifier: value, channel: canTextPhone ? phoneChannel : "email" });
  };

  const onPasswordSubmit = (data: z.infer<typeof passwordFormSchema>) => {
    if (!isPasswordValid) {
      passwordForm.setError("password", { message: "Your password doesn't meet the rules above yet." });
      return;
    }
    resetMutation.mutate(data);
  };

  const resend = (next: Channel = channel) => sendMutation.mutate({ identifier, channel: next });

  // The other ways to get the same code, one offered at a time.
  const alternative: { channel: Channel; label: string } | null =
    channel === "email"
      ? canTextPhone ? { channel: smsOn ? "sms" : "whatsapp", label: "Send it to my phone instead" } : null
      : channel === "sms"
        ? whatsappOn ? { channel: "whatsapp", label: "Send it by WhatsApp instead" } : { channel: "email", label: "Send it to my email instead" }
        : smsOn ? { channel: "sms", label: "Send it by SMS instead" } : { channel: "email", label: "Send it to my email instead" };

  const sentTo = channel === "email" ? "this email" : channel === "sms" ? "this number (by SMS)" : "this number (by WhatsApp)";
  const stepLabel = (n: number) => <p className="ks-stepno">Step {n} of 3</p>;
  const sending = sendMutation.isPending;

  const loginFooter = (
    <CardFooter className="ks-foot p-0">
      <p className="text-sm text-muted-foreground text-center">
        Remember your password?{" "}
        <Link href="/auth/login" data-testid="link-login">Log in</Link>
      </p>
    </CardFooter>
  );

  const submitLabel = (pending: boolean, busy: string, idle: string) =>
    pending ? (
      <>
        <Spinner className="mr-2 h-5 w-5 animate-spin" />
        {busy}
      </>
    ) : idle;

  return (
    <AuthShell variant="recovery" step={STEP_NUMBER[step]}>
      <Card className="ks-card">
        {step === "code" && (
          <Button variant="ghost" size="sm" onClick={() => setStep("request")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        )}

        {/* Step 1: get a code */}
        {step === "request" && (
          <>
            <CardHeader className="ks-head p-0">
              {stepLabel(1)}
              <CardTitle className="ks-title">Reset your password</CardTitle>
              <CardDescription className="ks-sub">
                Enter the phone number or email on your account and we'll send a 6-digit code.
              </CardDescription>
            </CardHeader>
            <CardContent className="ks-content space-y-4 p-0">
              <Tabs
                value={method}
                onValueChange={(v) => {
                  if (prefilled && v !== entry.method) {
                    setLockedTabTried(true);
                    return;
                  }
                  setMethod(v as "email" | "phone");
                }}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="email" aria-disabled={prefilled && entry.method !== "email"} className={prefilled && entry.method !== "email" ? "opacity-50 cursor-not-allowed" : undefined} data-testid="tab-forgot-email">Email</TabsTrigger>
                  <TabsTrigger value="phone" aria-disabled={prefilled && entry.method !== "phone"} className={prefilled && entry.method !== "phone" ? "opacity-50 cursor-not-allowed" : undefined} data-testid="tab-forgot-phone">Phone</TabsTrigger>
                </TabsList>
              </Tabs>
              {prefilled && lockedTabTried && (
                <p className="ks-hint" role="alert" data-testid="text-locked-reason">
                  You're resetting the password for the {entry.method === "email" ? "email" : "phone number"} you entered on the log in page,
                  so the {entry.method === "email" ? "Phone" : "Email"} option is turned off.{" "}
                  <Link href="/auth/login" className="font-semibold underline">Use a different account</Link>
                </p>
              )}

              {method === "email" ? (
                <Form {...emailForm}>
                  <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-4">
                    <FormField
                      control={emailForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email address</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="you@example.com"
                              autoComplete="email"
                              readOnly={prefilled}
                              data-testid="input-forgot-email"
                              {...field}
                            />
                          </FormControl>
                          {prefilled && entry.method === "email" && (
                            <p className="ks-hint">Filled in from the log in page.</p>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full" disabled={sending} data-testid="button-send-code">
                      {submitLabel(sending, "Sending...", "Send reset code")}
                    </Button>
                  </form>
                </Form>
              ) : (
                <Form {...phoneForm}>
                  <form onSubmit={phoneForm.handleSubmit(onPhoneSubmit)} className="space-y-4">
                    <div className="ks-phone">
                      <FormField
                        control={phoneForm.control}
                        name="phoneCountryCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Code</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value} disabled={prefilled}>
                              <FormControl>
                                <SelectTrigger data-testid="select-forgot-country-code">
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
                        control={phoneForm.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone Number</FormLabel>
                            <FormControl>
                              <Input
                                type="tel"
                                placeholder="Phone number"
                                autoComplete="tel-national"
                                readOnly={prefilled}
                                data-testid="input-forgot-phone"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    {prefilled && entry.method === "phone" && (
                      <p className="ks-hint">Filled in from the log in page.</p>
                    )}

                    {canTextPhone ? (
                      <div>
                        <p className="text-sm font-semibold" id="send-by-label">Send the code by</p>
                        <div className="ks-channels" role="radiogroup" aria-labelledby="send-by-label">
                          {smsOn && (
                            <Button
                              type="button"
                              variant="outline"
                              role="radio"
                              aria-checked={phoneChannel === "sms"}
                              className="ks-channel"
                              data-active={phoneChannel === "sms"}
                              onClick={() => setPhoneChannel("sms")}
                              data-testid="channel-sms"
                            >
                              <Smartphone className="mr-2 h-4 w-4" />
                              SMS
                            </Button>
                          )}
                          {whatsappOn && (
                            <Button
                              type="button"
                              variant="outline"
                              role="radio"
                              aria-checked={phoneChannel === "whatsapp"}
                              className="ks-channel"
                              data-active={phoneChannel === "whatsapp"}
                              onClick={() => setPhoneChannel("whatsapp")}
                              data-testid="channel-whatsapp"
                            >
                              <MessageSquare className="mr-2 h-4 w-4" />
                              WhatsApp
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="ks-hint">We'll email the code to the address on your account.</p>
                    )}

                    <Button type="submit" className="w-full" disabled={sending} data-testid="button-send-code">
                      {submitLabel(sending, "Sending...", "Send reset code")}
                    </Button>
                  </form>
                </Form>
              )}
            </CardContent>
            {loginFooter}
          </>
        )}

        {/* Step 2: enter the code */}
        {step === "code" && (
          <>
            <CardHeader className="ks-head p-0">
              {stepLabel(2)}
              <CardTitle className="ks-title">Enter your code</CardTitle>
              <CardDescription className="ks-sub">
                If an account uses {sentTo}, we've sent a 6-digit code to it.
              </CardDescription>
            </CardHeader>
            <CardContent className="ks-content space-y-4 p-0">
              <div className="ks-pill">
                <span data-testid="text-identifier">{identifierDisplay || identifier}</span>
                <button type="button" onClick={() => setStep("request")} data-testid="button-change-identifier">Change</button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.length !== CODE_LENGTH) {
                    setCodeError("Enter all 6 digits.");
                    return;
                  }
                  verifyMutation.mutate();
                }}
                className="space-y-4"
              >
                <div>
                  <p className="text-sm font-semibold mb-2" id="code-label">6-digit code</p>
                  <CodeBoxes
                    value={code}
                    onChange={(v) => { setCode(v); setCodeError(null); }}
                    invalid={!!codeError}
                  />
                  {codeError && (
                    <div className="flex items-start gap-2 text-destructive mt-2 text-sm" role="alert" data-testid="error-code">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{codeError}</span>
                    </div>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={verifyMutation.isPending} data-testid="button-verify-code">
                  {submitLabel(verifyMutation.isPending, "Verifying...", "Verify code")}
                </Button>
              </form>

              <p className="text-sm text-muted-foreground text-center">
                Didn't get it?{" "}
                {cooldown > 0 ? (
                  <>You can resend in 0:{String(cooldown).padStart(2, "0")}. <span className="font-semibold">Resend code</span></>
                ) : (
                  <button
                    type="button"
                    className="ks-link-btn"
                    disabled={sending}
                    onClick={() => resend()}
                    data-testid="button-resend-code"
                  >
                    Resend code
                  </button>
                )}
              </p>

              {!alternative && channel === "email" && (
                <>
                  <button
                    type="button"
                    className="ks-secondary opacity-50 cursor-not-allowed"
                    aria-disabled="true"
                    onClick={() => setNoTextTried(true)}
                    data-testid="button-switch-channel-unavailable"
                  >
                    Send it to my phone instead
                  </button>
                  {noTextTried && (
                    <p className="ks-hint text-center" role="alert" data-testid="text-no-text-codes">
                      Codes by text message aren't available right now, so this one can only go to your email.
                    </p>
                  )}
                </>
              )}

              {alternative && (
                <button
                  type="button"
                  className="ks-secondary"
                  disabled={sending}
                  onClick={() => resend(alternative.channel)}
                  data-testid="button-switch-channel"
                >
                  {alternative.label}
                </button>
              )}
            </CardContent>
            {loginFooter}
          </>
        )}

        {/* Step 3: new password */}
        {step === "password" && (
          <>
            <CardHeader className="ks-head p-0">
              {stepLabel(3)}
              <CardTitle className="ks-title">Choose a new password</CardTitle>
              <CardDescription className="ks-sub">You'll use it to log in on every device.</CardDescription>
            </CardHeader>
            <CardContent className="ks-content space-y-4 p-0">
              <Form {...passwordForm}>
                <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
                  <FormField
                    control={passwordForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New password</FormLabel>
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

                  <PasswordChecklist
                    password={passwordValue}
                    confirmPassword={passwordForm.watch("confirmPassword")}
                    onValidationChange={setIsPasswordValid}
                  />

                  <FormField
                    control={passwordForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm new password</FormLabel>
                        <FormControl>
                          <PasswordInput
                            placeholder="Confirm new password"
                            autoComplete="new-password"
                            data-testid="input-confirm-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <label className="ks-check-row cursor-pointer">
                    <Checkbox
                      checked={signOutOthers}
                      onCheckedChange={(c) => setSignOutOthers(!!c)}
                      data-testid="checkbox-sign-out-others"
                    />
                    Log out of Kowope on all other devices
                  </label>

                  {resetError && (
                    <div className="flex items-start gap-2 text-destructive text-sm" role="alert" data-testid="error-reset">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        {resetError}{" "}
                        <button type="button" className="ks-link-btn" onClick={() => setStep("request")}>
                          Get a new code
                        </button>
                      </span>
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={resetMutation.isPending} data-testid="button-reset">
                    {submitLabel(resetMutation.isPending, "Saving...", "Save new password")}
                  </Button>
                </form>
              </Form>
            </CardContent>
            {loginFooter}
          </>
        )}

        {/* Step 4: done */}
        {step === "done" && (
          <>
            <CardHeader className="ks-head ks-done p-0">
              <span className="ks-tick" aria-hidden="true"><Check size={28} /></span>
              <CardTitle className="ks-title">Password updated</CardTitle>
              <CardDescription className="ks-sub">
                {signOutOthers
                  ? "Log in with your new password. Any other device that was logged in will ask for it too."
                  : "Log in with your new password. Devices that are already logged in stay logged in."}
              </CardDescription>
            </CardHeader>
            <CardContent className="ks-content p-0">
              <Button
                className="w-full"
                onClick={() => setLocation(`/auth/login?identifier=${encodeURIComponent(identifier)}`)}
                data-testid="button-login"
              >
                Log in
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </AuthShell>
  );
}
