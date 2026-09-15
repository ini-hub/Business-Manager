import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ScrollText, ExternalLink, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { legalDocHref } from "@/lib/legal-docs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface LegalDocumentEntry {
  documentType: string;
  title: string;
  contentMarkdown: string;
}

/**
 * The proactive nudge for an already-logged-in session: hasAcceptedCurrentDocuments
 * is only re-checked at login/staff-activation time (server/routes.ts), so
 * without this, a document published while someone is mid-session would go
 * unnoticed until they happen to log back in - which could be up to 24h (or
 * longer, before "stay logged in" was removed) away. This polls consent
 * status and, if stale, shows a persistent (non-dismissible - it's a
 * required acceptance, not an FYI) banner with an inline review-and-accept
 * flow that never interrupts the session or forces a logout.
 */
export function LegalConsentBanner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showReview, setShowReview] = useState(false);
  const [acceptedDocs, setAcceptedDocs] = useState<Record<string, boolean>>({});

  const statusQuery = useQuery<{ hasAccepted: boolean }>({
    queryKey: ["/api/legal/consent-status"],
    enabled: !!user,
    // Not urgent enough to poll aggressively, but should surface within a
    // session rather than only on the next full page load.
    refetchInterval: 5 * 60 * 1000,
  });

  const legalDocsQuery = useQuery<{ documents: LegalDocumentEntry[] }>({
    queryKey: ["/api/legal"],
    enabled: showReview,
  });
  const legalDocs = legalDocsQuery.data?.documents ?? [];
  const allChecked = legalDocs.length > 0 && legalDocs.every((d) => acceptedDocs[d.documentType]);

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const acceptedDocumentTypes = legalDocs
        .filter((d) => acceptedDocs[d.documentType])
        .map((d) => d.documentType);
      const response = await apiRequest("POST", "/api/legal/accept", {
        affirmedReadAndAgree: true,
        acceptedDocumentTypes,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Thanks!", description: "Your acceptance has been recorded." });
      queryClient.invalidateQueries({ queryKey: ["/api/legal/consent-status"] });
      setShowReview(false);
      setAcceptedDocs({});
    },
    onError: (error: any) => {
      if (error.code === "LEGAL_DOCUMENTS_STALE") {
        queryClient.invalidateQueries({ queryKey: ["/api/legal"] });
        setAcceptedDocs({});
      }
      toast({
        title: "Could not record your acceptance",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  if (!user || !statusQuery.data || statusQuery.data.hasAccepted) return null;

  return (
    <>
      <div
        data-testid="banner-legal-consent"
        className="flex items-center gap-3 border-b px-4 py-2.5 text-sm bg-sky-50 text-sky-900 border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900"
      >
        <ScrollText className="h-4 w-4 shrink-0" />
        <p className="flex-1 min-w-0 leading-snug">
          We've updated our legal documents. Please review and accept them to continue.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 border-sky-300 dark:border-sky-800 bg-transparent hover:bg-sky-100 dark:hover:bg-sky-900/40"
          onClick={() => setShowReview(true)}
          data-testid="button-review-legal-documents"
        >
          Review
        </Button>
      </div>

      <Dialog open={showReview} onOpenChange={setShowReview}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review our legal documents</DialogTitle>
            <DialogDescription>
              Please confirm you've read and agree to each document below to continue.
            </DialogDescription>
          </DialogHeader>

          {legalDocsQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2.5">
              {legalDocs.map((doc) => (
                <div key={doc.documentType} className="flex items-start gap-2.5">
                  <Checkbox
                    checked={!!acceptedDocs[doc.documentType]}
                    onCheckedChange={(checked) =>
                      setAcceptedDocs((prev) => ({ ...prev, [doc.documentType]: !!checked }))
                    }
                    data-testid={`checkbox-review-accept-${doc.documentType}`}
                    className="mt-0.5"
                  />
                  <label className="font-normal text-sm text-muted-foreground leading-snug cursor-pointer select-none">
                    I have read and agree to the{" "}
                    <a
                      href={legalDocHref(doc.documentType)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-medium text-foreground hover:text-primary inline-flex items-center gap-1"
                      data-testid={`link-review-open-${doc.documentType}`}
                    >
                      {doc.title}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </label>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button
              className="w-full"
              disabled={!allChecked || acceptMutation.isPending}
              onClick={() => acceptMutation.mutate()}
              data-testid="button-accept-legal-documents"
            >
              {acceptMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Recording...
                </>
              ) : (
                "Agree & Continue"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default LegalConsentBanner;
