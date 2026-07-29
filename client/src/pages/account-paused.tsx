import { PauseCircle, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

/**
 * Shown to non-owner staff of an org that's trial-expired or suspended.
 * Billing is owner-only, so staff never see plan pickers or payment UI here -
 * just a clear explanation and a way to sign out.
 */
export function AccountPaused() {
  const { logout } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-full bg-muted p-3">
            <PauseCircle className="h-6 w-6 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-bold">This business account is paused</h1>
          <p className="text-muted-foreground">
            Please contact your business owner to reactivate the account before you can continue.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={logout} className="gap-2">
          <LogOut className="h-4 w-4" /> Log out
        </Button>
      </div>
    </div>
  );
}

export default AccountPaused;
