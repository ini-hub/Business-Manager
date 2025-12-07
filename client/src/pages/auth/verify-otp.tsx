import { useState, useEffect } from "react";
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
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, ArrowLeft, Mail, RefreshCw } from "lucide-react";

const verifyOtpSchema = z.object({
  email: z.string().email("Invalid email"),
  otp: z.string().length(6, "OTP must be exactly 6 digits").regex(/^\d+$/, "OTP must only contain numbers"),
});

type VerifyOtpFormData = z.infer<typeof verifyOtpSchema>;

export default function VerifyOtp() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(useSearch());
  const email = searchParams.get("email") || "";
  const type = searchParams.get("type") || "signup";
  const [resendCooldown, setResendCooldown] = useState(0);

  const maskedEmail = email.replace(/(.{2})(.*)(@.*)/, "$1***$3");

  const form = useForm<VerifyOtpFormData>({
    resolver: zodResolver(verifyOtpSchema),
    defaultValues: {
      email: email,
      otp: "",
    },
  });

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const verifyMutation = useMutation({
    mutationFn: async (data: VerifyOtpFormData) => {
      const response = await apiRequest("POST", "/api/auth/verify-otp", data);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Email verified!",
        description: "Your email has been verified successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    },
    onError: (error: any) => {
      toast({
        title: "Verification failed",
        description: error.error || "Invalid or expired OTP code.",
        variant: "destructive",
      });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/resend-otp", { email, type });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "OTP sent!",
        description: `A new verification code has been sent to ${maskedEmail}`,
      });
      setResendCooldown(60);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to resend",
        description: error.error || "Could not resend OTP. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: VerifyOtpFormData) => {
    verifyMutation.mutate(data);
  };

  if (!email) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Invalid Request</CardTitle>
            <CardDescription>
              No email address provided for verification.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Link href="/auth/login" className="w-full">
              <Button className="w-full" data-testid="button-back-login">
                Back to Login
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link href="/auth/login">
            <Button variant="ghost" size="sm" className="absolute left-4 top-4" data-testid="button-back">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Verify Your Email</CardTitle>
          <CardDescription>
            We've sent a 6-digit code to <br />
            <span className="font-medium text-foreground">{maskedEmail}</span>
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
                    <FormLabel>Verification Code</FormLabel>
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

              <p className="text-sm text-muted-foreground text-center">
                For testing, use: <span className="font-mono font-medium">123456</span>
              </p>

              <Button
                type="submit"
                className="w-full"
                disabled={verifyMutation.isPending}
                data-testid="button-verify"
              >
                {verifyMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify Email"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <div className="text-center w-full">
            <p className="text-sm text-muted-foreground mb-2">
              Didn't receive the code?
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => resendMutation.mutate()}
              disabled={resendMutation.isPending || resendCooldown > 0}
              data-testid="button-resend"
            >
              {resendMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : resendCooldown > 0 ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Resend in {resendCooldown}s
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Resend Code
                </>
              )}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
