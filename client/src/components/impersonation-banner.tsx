import { useState } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";

// Shown while a super admin is looking at a business as its owner (read-only).
export function ImpersonationBanner() {
  const [busy, setBusy] = useState(false);
  const exit = async () => {
    setBusy(true);
    try {
      await apiRequest("POST", "/api/auth/impersonation/exit");
    } finally {
      queryClient.clear();
      window.location.href = "/super-admin/deleted-businesses";
    }
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-950" data-testid="banner-impersonation">
      <span className="flex items-center gap-2"><Eye className="h-4 w-4" /> Read-only owner view. Nothing you do here can change this business.</span>
      <Button size="sm" variant="outline" onClick={exit} disabled={busy} data-testid="button-exit-impersonation">Exit view</Button>
    </div>
  );
}
