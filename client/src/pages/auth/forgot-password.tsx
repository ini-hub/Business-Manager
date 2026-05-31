import { KowopeBrand } from "@/components/kowope-brand";
import { useState } from "react";
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
import { apiRequest } from "@/lib/queryClient";
import { Loader2, ArrowLeft, Mail, CheckCircle2 } from "lucide-react";

const forgotPasswordSchema = z.object({
  emailOrPhone: z.string().min(1, "Email or phone number is required"),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPassword() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [codeSent, setCodeSent] = useState(false);
  const [sentIdentifier, setSentIdentifier] = useState("");
  const [maskedId, setMaskedId] = useState("");

  const form = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      emailOrPhone: "",
    },
  });

  const forgotMutation = useMutation({
    mutationFn: async (data: ForgotPasswordFormData) => {
      const response = await apiRequest("POST", "/api/auth/forgot-password", data);
      return response.json();
    },
    onSuccess: (data, variables) => {
      setSentIdentifier(variables.emailOrPhone);
      setMaskedId(data.maskedIdentifier || variables.emailOrPhone);
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

  const onSubmit = (data: ForgotPasswordFormData) => {
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
              }}
              data-testid="button-try-different"
            >
              Try a different identifier
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
            Enter your email address or phone number and we'll send you a 6-digit code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="emailOrPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email or Phone Number</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="you@example.com or +234..."
                        data-testid="input-email-or-phone"
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
