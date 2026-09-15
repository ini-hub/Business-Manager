// The three seeded defaults (see migrations/0055_legal_documents_consent.sql)
// get friendly, memorable URLs; any further section a super admin adds
// (LegalDocumentService.createDocument, client/src/pages/admin/LegalDocuments.tsx)
// falls back to the generic /legal/:type route - both are registered in App.tsx.
const FRIENDLY_LEGAL_PATHS: Record<string, string> = {
  terms_and_conditions: "/terms",
  privacy_policy: "/privacy",
  data_usage_policy: "/data-usage",
};

export function legalDocHref(documentType: string): string {
  return FRIENDLY_LEGAL_PATHS[documentType] ?? `/legal/${documentType}`;
}
