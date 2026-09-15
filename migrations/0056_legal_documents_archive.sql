-- Lets a super admin deactivate a legal document/section (e.g. a Cookie
-- Policy added by mistake, or retired) without breaking the audit trail -
-- legal_document_acceptances rows keep referencing it forever, so a hard
-- DELETE is only ever safe for a document nobody has accepted yet (enforced
-- in application code, not here). Archiving instead just excludes it from
-- LegalDocumentService.listAllCurrent/hasAcceptedCurrentDocuments and the
-- public /api/legal reads, while the super-admin list still shows it (with
-- a Reactivate action) via a separate "including archived" query.
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS archived_at timestamp;
