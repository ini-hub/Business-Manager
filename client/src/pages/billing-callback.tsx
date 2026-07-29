import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type VerifyState = "verifying" | "success" | "failed";

/**
 * Landing page after a Paystack checkout redirect. Rendered from App.tsx
 * BEFORE the isOrgLocked() gate (not inside the normal route Switch), because
 * the org is typically still locked when this page is hit - unlocking is
 * exactly what verifying the payment here does.
 */
export default function BillingCallback() {
  const [state, setState] = useState<VerifyState>("verifying");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    if (!reference) {
      setState("failed");
      setMessage("No payment reference was returned. If you were charged, contact support.");
      return;
    }

    apiRequest("GET", `/api/billing/verify?reference=${encodeURIComponent(reference)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "We couldn't confirm your payment.");
        if (body.status === "success") {
          setState("success");
        } else {
          setState("failed");
          setMessage("Paystack reported this payment did not succeed.");
        }
      })
      .catch((err: Error) => {
        setState("failed");
        setMessage(err.message);
      });
  }, []);

  const goToApp = () => {
    // Full reload (not client-side navigation) so business/subscription
    // state - and the paywall gate that reads it - is fetched fresh.
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          {state === "verifying" && (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
              <h1 className="text-lg font-semibold">Confirming your payment…</h1>
              <p className="text-sm text-muted-foreground">This only takes a moment.</p>
            </>
          )}
          {state === "success" && (
            <>
              <div className="rounded-full bg-emerald-500/10 p-3">
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              </div>
              <h1 className="text-lg font-semibold">Payment confirmed</h1>
              <p className="text-sm text-muted-foreground">Your subscription is now active.</p>
              <Button onClick={goToApp} className="mt-2">Continue to app</Button>
            </>
          )}
          {state === "failed" && (
            <>
              <div className="rounded-full bg-destructive/10 p-3">
                <XCircle className="h-6 w-6 text-destructive" />
              </div>
              <h1 className="text-lg font-semibold">We couldn't confirm this payment</h1>
              <p className="text-sm text-muted-foreground">{message}</p>
              <Button onClick={goToApp} variant="outline" className="mt-2">Back to app</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
