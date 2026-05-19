import { Store, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";

interface StoreRequiredAlertProps {
  title?: string;
}

export function StoreRequiredAlert({ title = "Store Setup Required" }: StoreRequiredAlertProps) {
  const { user } = useAuth();
  const isStaff = user?.role === "staff";

  return (
    <div className="flex items-center justify-center p-6 min-h-[400px]">
      <Card className="w-full max-w-md border-primary/10 shadow-xl bg-background/50 backdrop-blur-md relative overflow-hidden">
        {/* Subtle decorative glow circles */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-primary/10 rounded-full blur-2xl" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl" />
        
        <CardHeader className="flex flex-col items-center text-center pb-2 pt-6">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <Store className="h-6 w-6 text-primary animate-pulse" />
          </div>
          <CardTitle className="text-xl font-bold tracking-tight">{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center text-center pb-6">
          {isStaff ? (
            <>
              <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                A store has to be created for you to proceed. Please contact your manager or store owner.
              </p>
              <div className="mt-6 flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/60 text-xs text-muted-foreground font-medium">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                Staff Account
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground max-w-xs leading-relaxed mb-6">
                You need to set up your business and store first before accessing this module.
              </p>
              <Button asChild className="w-full sm:w-auto shadow-md">
                <Link href="/settings/stores">Set Up Store</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
