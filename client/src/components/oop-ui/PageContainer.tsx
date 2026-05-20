import * as React from "react";
import { PageHeader } from "@/components/page-header";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageContainerProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  storeRequired?: boolean;
  currentStore?: any;
  requiredRole?: "owner" | "manager" | "staff";
  currentUserRole?: string;
  isLoading?: boolean;
  children: React.ReactNode;
  className?: string;
}

export const PageContainer: React.FC<PageContainerProps> = ({
  title,
  description,
  actions,
  storeRequired = false,
  currentStore,
  requiredRole,
  currentUserRole,
  isLoading = false,
  children,
  className,
}) => {
  if (requiredRole && currentUserRole) {
    const isAuthorized =
      requiredRole === "staff" ||
      (requiredRole === "manager" && currentUserRole !== "staff") ||
      (requiredRole === "owner" && currentUserRole === "owner");

    if (!isAuthorized) {
      return (
        <div className="space-y-6">
          <PageHeader title={title} description={description} />
          <Alert variant="destructive" className="border-red-500/20 bg-red-500/5">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <AlertDescription className="text-red-600 dark:text-red-400 font-medium">
              You do not have permission to view this section. This page is restricted to {requiredRole}s.
            </AlertDescription>
          </Alert>
        </div>
      );
    }
  }

  if (storeRequired && !currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title={title} description={description} />
        <StoreRequiredAlert title={`Store Required for ${title}`} />
      </div>
    );
  }

  return (
    <div className={cn("space-y-6 animate-in fade-in duration-300", className)}>
      <PageHeader title={title} description={description} actions={actions} />
      
      {isLoading ? (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-2 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm font-medium">Loading details...</span>
        </div>
      ) : (
        children
      )}
    </div>
  );
};
