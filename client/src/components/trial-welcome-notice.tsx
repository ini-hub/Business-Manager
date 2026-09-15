import { PartyPopper, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trialDaysRemaining } from "@/lib/trial";
import type { Business } from "@shared/schema";

/**
 * One-time blocking notice shown to a new owner right after signup, before
 * they reach the onboarding wizard - distinct from the Terms/Privacy/Data
 * Usage consent checkbox on the signup form itself, so the trial length and
 * what happens after it isn't buried in fine print. Gated in App.tsx's
 * AuthenticatedLayout on organisations.trialConsentAcceptedAt being null;
 * clicking Continue clears the gate for good.
 */
export function TrialWelcomeNotice({ business }: { business: Business }) {
  const { toast } = useToast();
  const daysRemaining = trialDaysRemaining(business);

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/business/accept-trial-consent");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not continue",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md">
        <Card>
          <CardContent className="p-8 space-y-6 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-full bg-primary/10 p-3">
                <PartyPopper className="h-6 w-6 text-primary" />
              </div>
              <h1 className="text-xl font-bold">Welcome to Kowope, {business.name}!</h1>
            </div>

            <div className="text-left space-y-3 text-sm text-muted-foreground">
              <p>
                You're starting a{" "}
                <span className="font-semibold text-foreground">
                  {daysRemaining > 0 ? `${daysRemaining}-day` : "14-day"} free trial
                </span>{" "}
                with full access to every feature in Kowope — no card required, right now.
              </p>
              <p>
                Once your trial ends, your business account stays active, but you'll move to our free
                tier and choose only the features you want to keep. Nothing is deleted, and nothing is
                charged automatically — you're always in control of what you pay for.
              </p>
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={acceptMutation.isPending}
              onClick={() => acceptMutation.mutate()}
              data-testid="button-accept-trial-consent"
            >
              {acceptMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Continuing...
                </>
              ) : (
                "Continue"
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default TrialWelcomeNotice;
