import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { LegalDocumentViewer } from "@/components/legal-document-viewer";

interface LegalDocumentResponse {
  documentType: string;
  title: string;
  contentMarkdown: string;
  versionNumber: number;
  publishedAt: string;
}

/** One component behind /terms, /privacy, /data-usage, and the generic /legal/:type - parameterized by documentType. */
export function LegalDocumentPage({ documentType }: { documentType: string }) {
  const { data, isLoading, error } = useQuery<LegalDocumentResponse>({
    queryKey: [`/api/legal/${documentType}`],
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-10 sm:py-14">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-4 w-4" />
          Back home
        </Link>

        {isLoading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && !isLoading && (
          <p className="text-sm text-muted-foreground">
            This document could not be loaded right now. Please try again shortly.
          </p>
        )}

        {data && (
          <>
            <h1 className="text-3xl font-bold tracking-tight mb-1">{data.title}</h1>
            <p className="text-xs text-muted-foreground mb-8">
              Version {data.versionNumber} · Last updated {new Date(data.publishedAt).toLocaleDateString()}
            </p>
            <LegalDocumentViewer contentMarkdown={data.contentMarkdown} />
          </>
        )}
      </div>
    </div>
  );
}

export function TermsPage() {
  return <LegalDocumentPage documentType="terms_and_conditions" />;
}

export function PrivacyPage() {
  return <LegalDocumentPage documentType="privacy_policy" />;
}

export function DataUsagePage() {
  return <LegalDocumentPage documentType="data_usage_policy" />;
}

/** Generic /legal/:type route - reaches any section a super admin adds beyond the three friendly-path defaults above. */
export function LegalDocumentByParamPage() {
  const { type } = useParams<{ type: string }>();
  return <LegalDocumentPage documentType={type} />;
}
