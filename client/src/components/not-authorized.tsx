import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert, Home } from "lucide-react";

/**
 * Rendered in place of an admin-only page when the current role isn't
 * allowed there — the URL stays exactly where the user typed it, no
 * `<Redirect>` bounce. Modeled on not-found.tsx's empty-state card.
 */
export default function NotAuthorized() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-6">
            <ShieldAlert className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-semibold mb-2">You don't have access to this page</h1>
          <p className="text-muted-foreground mb-6">
            This page is for managers and owners. If you think you should be able to see it, ask your manager.
          </p>
          <Button asChild>
            <Link href="/">
              <Home className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
