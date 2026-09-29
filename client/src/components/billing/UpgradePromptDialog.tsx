import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { openBilling, subscribeToPlanLimit, upgradeTitle, type PlanLimitDetails } from "@/lib/upgrade-prompt";

/**
 * The single place a blocked action turns into "upgrade to continue". Mounted
 * once in App.tsx; opens whenever a write request is refused for plan reasons
 * (free-plan cap reached, or an add-on the org hasn't bought) - see apiRequest.
 * Existing data stays untouched and readable; only adding more is blocked.
 */
export function UpgradePromptDialog() {
  const [details, setDetails] = useState<PlanLimitDetails | null>(null);
  const [, navigate] = useLocation();

  useEffect(() => subscribeToPlanLimit(setDetails), []);

  return (
    <AlertDialog open={!!details} onOpenChange={(open) => { if (!open) setDetails(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{details ? upgradeTitle(details) : ""}</AlertDialogTitle>
          <AlertDialogDescription>{details?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction onClick={() => openBilling(navigate)}>View plans &amp; add-ons</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
