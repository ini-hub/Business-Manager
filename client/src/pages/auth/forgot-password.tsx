import { KowopeBrand } from "@/components/kowope-brand";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, ArrowLeft, Mail, MessageSquare, CheckCircle2 } from "lucide-react";
import { validateEmailOrPhone } from "@/lib/validation-utils";
import { deduplicatedCountryCodes } from "@/lib/phone-utils";

const emailSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  channel: z.literal("email"),
});

const phoneSchema = z.object({
  phone: z.string().min(5, "Enter a valid phone number"),
  countryCode: z.string(),
  channel: z.enum(["email", "sms", "whatsapp"]),
});

type EmailFormData = z.infer<typeof emailSchema>;
type PhoneFormData = z.infer<typeof phoneSchema>;

export default function ForgotPassword() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [codeSent, setCodeSent] = useState(false);
  const [sentIdentifier, setSentIdentifier] = useState("");
  const [maskedId, setMaskedId] = useState("");
  const [method, setMethod] = useState<"email" | "phone">("email");

  // Get SMS/WhatsApp configuration
  const { data: smsConfig } = useQuery<{ smsEnabled: boolean; whatsappEnabled: boolean }>({
    queryKey: ["/api/auth/platform-sms-config"],
  });

  // Use a default country code since store context is not available during auth
  const defaultCountry = "NG";
  const defaultDialCode = deduplicatedCountryCodes.find(c => c.code === defaultCountry)?.dialCode ?? "+234";

  const emailForm = useForm<EmailFormData>({
    resolver: zodResolver(emailSchema),
    defaultValues: {
      email: "",
      channel: "email",
    },
  });

  const phoneForm = useForm<PhoneFormData>({
    resolver: zodResolver(phoneSchema),
    defaultValues: {
      phone: "",
      countryCode: defaultDialCode,
      channel: "email",
    },
  });

  const forgotMutation = useMutation({
    mutationFn: async (data: EmailFormData | PhoneFormData) => {
      const payload = "email" in data
        ? { email: data.email, channel: "email" }
        : { phone: data.phone, countryCode: data.countryCode, channel: data.channel };
      const response = await apiRequest("POST", "/api/auth/forgot-password", payload);
      return response.json();
    },
    onSuccess: (data, variables) => {
      const identifier = "email" in variables ? variables.email : variables.phone;
      setSentIdentifier(identifier);
      setMaskedId(data.maskedIdentifier || identifier);
      setCodeSent(true);
      toast({
        title: "Reset code sent",
        description: data.message,
      });
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.error || "Could not process request. Please try again.";
      toast({
        title: "Request failed",
        description: errorMsg,
        variant: "destructive",
      });
    },
  });

  const onEmailSubmit = (data: EmailFormData) => {
    forgotMutation.mutate(data);
  };

  const onPhoneSubmit = (data: PhoneFormData) => {
    forgotMutation.mutate(data);
  };

  if (codeSent) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-[hsl(214,25%,96%)] to-[hsl(210,15%,92%)] dark:from-[hsl(214,22%,6%)] dark:to-[hsl(214,22%,9%)] p-4 gap-5">
        <Card className="w-full max-w-md relative">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="h-6 w-6 text-blue-500" />
            </div>
            <CardTitle className="text-2xl font-bold">
              Check Your Device
            </CardTitle>
            <CardDescription>
              We've sent a 6-digit verification code to reset your password.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm">
            <p>
              If an account exists for <span className="font-medium text-blue-500">{maskedId}</span>, you'll receive a code shortly.
            </p>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button
              className="w-full"
              onClick={() => setLocation(`/auth/reset-password?emailOrPhone=${encodeURIComponent(sentIdentifier)}`)}
              data-testid="button-continue-reset"
            >
              Enter Reset Code
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setCodeSent(false);
                setSentIdentifier("");
                setMaskedId("");
              }}
              data-testid="button-try-different"
            >
              Try a different contact method
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-[hsl(214,25%,96%)] to-[hsl(210,15%,92%)] dark:from-[hsl(214,22%,6%)] dark:to-[hsl(214,22%,9%)] p-4 gap-5">
      <KowopeBrand />
      <Card className="w-full max-w-md relative">
        <Link href="/auth/login" className="absolute left-4 top-4">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <CardHeader className="text-center pt-12">
          <div className="mx-auto w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center mb-4">
            <Mail className="h-6 w-6 text-blue-500" />
          </div>
          <CardTitle className="text-2xl font-bold">
            Forgot Password?
          </CardTitle>
          <CardDescription>
            Choose how you'd like to receive your reset code.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={method} onValueChange={(v) => setMethod(v as "email" | "phone")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="email" data-testid="tab-forgot-email">Email</TabsTrigger>
              <TabsTrigger value="phone" data-testid="tab-forgot-phone">Phone</TabsTrigger>
            </TabsList>
          </Tabs>

          {method === "email" ? (
            <Form {...emailForm}>
              <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-4">
                <FormField
                  control={emailForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="you@example.com"
                          data-testid="input-forgot-email"
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
                  disabled={forgotMutation.isPending}
                  data-testid="button-send-code"
                >
                  {forgotMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Code"
                  )}
                </Button>
              </form>
            </Form>
          ) : (
            <Form {...phoneForm}>
              <form onSubmit={phoneForm.handleSubmit(onPhoneSubmit)} className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <FormField
                    control={phoneForm.control}
                    name="countryCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Code</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-forgot-country-code">
                              <SelectValue />
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
                      <FormItem className="col-span-2">
                        <FormLabel>Phone Number</FormLabel>
                        <FormControl>
                          <Input
                            type="tel"
                            placeholder="08012345678"
                            data-testid="input-forgot-phone"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={phoneForm.control}
                  name="channel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Delivery Method</FormLabel>
                      <div className="grid grid-cols-1 gap-2">
                        <Button
                          type="button"
                          variant={field.value === "email" ? "default" : "outline"}
                          className="justify-start"
                          onClick={() => field.onChange("email")}
                          data-testid="channel-email"
                        >
                          <Mail className="mr-2 h-4 w-4" />
                          Email
                        </Button>
                        <Button
                          type="button"
                          variant={field.value === "sms" ? "default" : "outline"}
                          className="justify-start"
                          onClick={() => field.onChange("sms")}
                          disabled={!smsConfig?.smsEnabled}
                          data-testid="channel-sms"
                        >
                          <MessageSquare className="mr-2 h-4 w-4" />
                          SMS {!smsConfig?.smsEnabled && "(Not configured)"}
                        </Button>
                        <Button
                          type="button"
                          variant={field.value === "whatsapp" ? "default" : "outline"}
                          className="justify-start"
                          onClick={() => field.onChange("whatsapp")}
                          disabled={!smsConfig?.whatsappEnabled}
                          data-testid="channel-whatsapp"
                        >
                          <MessageSquare className="mr-2 h-4 w-4" />
                          WhatsApp {!smsConfig?.whatsappEnabled && "(Not configured)"}
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={forgotMutation.isPending}
                  data-testid="button-send-code"
                >
                  {forgotMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Code"
                  )}
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
        <CardFooter>
          <p className="text-sm text-center w-full text-muted-foreground">
            Remember your password?{" "}
            <Link href="/auth/login" className="text-blue-500 hover:underline" data-testid="link-login">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
