import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CheckCircle2, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PersonalTab } from "@/components/hr/PersonalTab";
import { EmergencyContactsTab } from "@/components/hr/EmergencyContactsTab";
import { GuarantorTab } from "@/components/hr/GuarantorTab";

interface StatusResponse { outstandingSections: Array<"personal" | "emergency" | "guarantor">; requiredSections: Array<"personal" | "emergency" | "guarantor">; complete: boolean }

/**
 * Onboarding-gate landing page: a new staff member lands here (instead of
 * the dashboard) when required HR profile sections are still outstanding -
 * see server/lib/hrProfileGate.ts and the profile_pending_token cookie
 * minted by server/lib/authFlow.ts. Reuses the same tab components as the
 * post-activation HR profile page (client/src/pages/hr-profile.tsx), just
 * pointed at the pre-activation /api/profile-completion/* routes via
 * basePath, and gated by that cookie rather than a normal session - see
 * requireProfilePendingToken in server/auth.ts.
 */
export default function CompleteProfilePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: status, isLoading } = useQuery<StatusResponse>({
    queryKey: ["/api/profile-completion/status"],
    queryFn: async () => (await apiRequest("GET", "/api/profile-completion/status")).json(),
  });

  const completeMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/profile-completion/complete")).json(),
    onSuccess: () => {
      toast({ title: "Profile complete. Welcome aboard!" });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    },
    onError: (error: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile-completion/status"] });
      toast({ variant: "destructive", title: "Not quite done yet", description: getUserFriendlyError(error) });
    },
  });

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const outstanding = status?.outstandingSections ?? [];
  // Render every required section, not just the still-outstanding ones - a
  // section that's done (e.g. emergency contact saved) should keep showing
  // its saved data on future visits/relogins instead of disappearing, since
  // these tab components are also where that data is displayed.
  const required = status?.requiredSections ?? [];
  // staffId isn't needed by the profile-completion basePath (the pending
  // token already scopes every request server-side), so a placeholder is
  // fine here - the components never read it in that mode.
  const staffId = "self";

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-[26px] font-bold">Complete your profile</h1>
          <p className="text-muted-foreground text-sm mt-1">Please finish the sections below before continuing to your dashboard.</p>
        </div>

        {required.includes("personal") && (
          <Card>
            <CardHeader><CardTitle>Personal Information {!outstanding.includes("personal") && <CheckCircle2 className="inline h-4 w-4 text-green-600 ml-1" />}</CardTitle><CardDescription>Basic details your employer requires on file.</CardDescription></CardHeader>
            <CardContent><PersonalTab staffId={staffId} basePath="/api/profile-completion" /></CardContent>
          </Card>
        )}

        {required.includes("emergency") && (
          <Card>
            <CardHeader><CardTitle>Emergency Contact {!outstanding.includes("emergency") && <CheckCircle2 className="inline h-4 w-4 text-green-600 ml-1" />}</CardTitle><CardDescription>At least one contact is required.</CardDescription></CardHeader>
            <CardContent><EmergencyContactsTab staffId={staffId} basePath="/api/profile-completion" /></CardContent>
          </Card>
        )}

        {required.includes("guarantor") && (
          <Card>
            <CardHeader><CardTitle>Guarantor Form {!outstanding.includes("guarantor") && <CheckCircle2 className="inline h-4 w-4 text-green-600 ml-1" />}</CardTitle><CardDescription>Enter your own and your next of kin's details below, then tell us who your guarantor is - we'll email them a secure link to fill in and sign their own section. You won't fill in anything on their behalf.</CardDescription></CardHeader>
            <CardContent><GuarantorTab staffId={staffId} basePath="/api/profile-completion" /></CardContent>
          </Card>
        )}

        {required.length === 0 && (
          <Card>
            <CardContent className="pt-6 flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-5 w-5 text-green-600" /> All required sections are complete.
            </CardContent>
          </Card>
        )}

        <Button size="lg" onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending} data-testid="button-complete-profile">
          {completeMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Continue to dashboard
        </Button>
      </div>
    </div>
  );
}
